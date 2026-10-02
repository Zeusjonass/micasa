#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export AWS_PROFILE="${AWS_PROFILE:-admin-panel}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy || true

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
if [[ "$ACCOUNT" != "276009030184" ]]; then
  echo "Perfil $AWS_PROFILE no es la cuenta de MiCasa (276009030184). Aborto."
  exit 1
fi

ROLE_NAME="micasa-chat-role"
FN_NAME="micasa-chat"
API_NAME="micasa-http"
POLICY_NAME="micasa-chat-policy"

echo "== GSI gsi1 =="
INDEXES="$(aws dynamodb describe-table --table-name micasa --query 'Table.GlobalSecondaryIndexes[].IndexName' --output text || true)"
if [[ "$INDEXES" != *"gsi1"* ]]; then
  aws dynamodb update-table --table-name micasa \
    --attribute-definitions AttributeName=gsi1pk,AttributeType=S AttributeName=gsi1sk,AttributeType=S \
    --global-secondary-index-updates '[{"Create":{"IndexName":"gsi1","KeySchema":[{"AttributeName":"gsi1pk","KeyType":"HASH"},{"AttributeName":"gsi1sk","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}}]' \
    >/dev/null
  echo "Creando gsi1..."
  aws dynamodb wait table-exists --table-name micasa
else
  echo "gsi1 ya existe"
fi

echo "== IAM role =="
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "role ya existe"
else
  aws iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document "file://infra/iam-trust.json" >/dev/null
fi
aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$POLICY_NAME" --policy-document "file://infra/iam-policy.json"
ROLE_ARN="$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)"

echo "== zip Lambda =="
rm -f /tmp/micasa-chat.zip
(
  cd infra/chat
  # infra/chat/templates/*.json es la única fuente de verdad de las plantillas de
  # contrato (el frontend ya no mantiene una copia propia).
  zip -q /tmp/micasa-chat.zip handler.py agent.py clauses.py compose.py wording.py templates/*.json
)

# TEMPORAL: Kimi K3. El default del código es Haiku.
# Para volver a Haiku: USE_KIMI_NOW=0 y MODEL_ID/FALLBACK_MODEL_ID =
# us.anthropic.claude-3-5-haiku-20241022-v1:0 en las Variables de abajo.

echo "== Lambda $FN_NAME =="
if aws lambda get-function --function-name "$FN_NAME" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN_NAME" --zip-file fileb:///tmp/micasa-chat.zip >/dev/null
  aws lambda wait function-updated --function-name "$FN_NAME"
  aws lambda update-function-configuration \
    --function-name "$FN_NAME" \
    --timeout 60 \
    --memory-size 1024 \
    --environment "Variables={REGION=us-east-1,USE_KIMI_NOW=1,MODEL_ID=us.moonshotai.kimi-k3,FALLBACK_MODEL_ID=us.anthropic.claude-3-5-haiku-20241022-v1:0,KB_ID=Q1UNTTTE8X,DDB_TABLE=micasa,TOP_K=5,USER_ID=admin,TEMPLATES_BUCKET=micasa-kb-source,TEMPLATES_PREFIX=templates/}" \
    >/dev/null
  aws lambda wait function-updated --function-name "$FN_NAME"
else
  echo "Esperando a que el role se propague..."
  sleep 8
  aws lambda create-function \
    --function-name "$FN_NAME" \
    --runtime python3.13 \
    --handler handler.handler \
    --role "$ROLE_ARN" \
    --timeout 60 \
    --memory-size 1024 \
    --zip-file fileb:///tmp/micasa-chat.zip \
    --environment "Variables={REGION=us-east-1,USE_KIMI_NOW=1,MODEL_ID=us.moonshotai.kimi-k3,FALLBACK_MODEL_ID=us.anthropic.claude-3-5-haiku-20241022-v1:0,KB_ID=Q1UNTTTE8X,DDB_TABLE=micasa,TOP_K=5,USER_ID=admin,TEMPLATES_BUCKET=micasa-kb-source,TEMPLATES_PREFIX=templates/}" \
    >/dev/null
  aws lambda wait function-active --function-name "$FN_NAME"
fi
FN_ARN="$(aws lambda get-function --function-name "$FN_NAME" --query 'Configuration.FunctionArn' --output text)"

echo "== HTTP API =="
API_ID="$(aws apigatewayv2 get-apis --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)"
if [[ -z "$API_ID" || "$API_ID" == "None" ]]; then
  API_ID="$(aws apigatewayv2 create-api \
    --name "$API_NAME" \
    --protocol-type HTTP \
    --cors-configuration AllowOrigins='*',AllowMethods='GET,POST,PUT,DELETE,OPTIONS',AllowHeaders='content-type' \
    --query ApiId --output text)"
else
  aws apigatewayv2 update-api --api-id "$API_ID" \
    --cors-configuration AllowOrigins='*',AllowMethods='GET,POST,PUT,DELETE,OPTIONS',AllowHeaders='content-type' \
    >/dev/null
fi

INTEGRATION_ID="$(aws apigatewayv2 get-integrations --api-id "$API_ID" --query 'Items[0].IntegrationId' --output text)"
if [[ -z "$INTEGRATION_ID" || "$INTEGRATION_ID" == "None" ]]; then
  INTEGRATION_ID="$(aws apigatewayv2 create-integration \
    --api-id "$API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "$FN_ARN" \
    --payload-format-version 2.0 \
    --query IntegrationId --output text)"
fi

# Una sola ruta proxy: el enrutamiento real (proyectos/documentos/turnos/ask) vive
# dentro del Lambda (infra/chat/handler.py), no en API Gateway. Menos recursos AWS
# que mantener a mano cada vez que se agrega un endpoint.
ROUTE="$(aws apigatewayv2 get-routes --api-id "$API_ID" --query "Items[?RouteKey=='ANY /{proxy+}'].RouteId | [0]" --output text)"
if [[ -z "$ROUTE" || "$ROUTE" == "None" ]]; then
  aws apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key "ANY /{proxy+}" \
    --target "integrations/$INTEGRATION_ID" >/dev/null
fi

LEGACY_ROUTE="$(aws apigatewayv2 get-routes --api-id "$API_ID" --query "Items[?RouteKey=='POST /chat'].RouteId | [0]" --output text)"
if [[ -n "$LEGACY_ROUTE" && "$LEGACY_ROUTE" != "None" ]]; then
  aws apigatewayv2 delete-route --api-id "$API_ID" --route-id "$LEGACY_ROUTE" >/dev/null
  echo "Ruta legada POST /chat eliminada"
fi

STAGE="$(aws apigatewayv2 get-stages --api-id "$API_ID" --query "Items[?StageName=='\$default'].StageName | [0]" --output text)"
if [[ -z "$STAGE" || "$STAGE" == "None" ]]; then
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null
fi

aws lambda add-permission \
  --function-name "$FN_NAME" \
  --statement-id apigateway-micasa-chat \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:${ACCOUNT}:${API_ID}/*/*" \
  >/dev/null 2>&1 || true

API_URL="$(aws apigatewayv2 get-api --api-id "$API_ID" --query ApiEndpoint --output text)"
echo "$API_URL" > infra/.api-url
echo "API_URL=$API_URL"
echo "Listo. Rutas disponibles:"
echo "  GET/POST  $API_URL/projects"
echo "  GET/POST  $API_URL/projects/{projectId}/documents"
echo "  GET       $API_URL/projects/{projectId}/documents/{docId}"
echo "  POST      $API_URL/projects/{projectId}/documents/{docId}/turns"
echo "  GET/POST  $API_URL/projects/{projectId}/ask"
