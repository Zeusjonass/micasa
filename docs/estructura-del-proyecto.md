Prototipo de contratos con RAG en AWS (usando S3 como base de datos vectorial)

El presente documento describe la estructura del proyecto: qué hace la app, cómo está armado el RAG dentro de AWS, con qué se alimenta, y cómo se relacionan las herramientas que usé con las que pedía el enunciado. Recientemente anunciaron que en S3 ahora es posible crear bases de datos vectoriales (Amazon S3 Vectors + Amazon Bedrock). Me pareció buena idea experimentar con esa herramienta, aprovechando igualmente el resto del ecosistema en la nube.

1. Qué es y por qué hay RAG

MiCasa es un prototipo para armar borradores de contratos de vivienda en Yucatán: arrendamiento (renta) o compraventa. La idea sería contratos en general; este recorte es para acotar el alcance. Hablas con un agente. El sistema arma o actualiza el documento con lo que vas pidiendo, y también se puede editar a mano cualquier fragmento, como en Word o Google Docs. Se revisa y se baja en Word o PDF. No es un despacho ni sustituye a un abogado: el texto sale como borrador informativo.

Un modelo grande “sabe” español y algo de derecho mexicano, pero no tiene el Código Civil de Yucatán como fuente de verdad. Mezcla el federal con el estatal y a veces cita al revés. El RAG sirve para anclarlo a textos que nosotros subimos: primero busca trozos cercanos a la pregunta, y recién entonces el modelo explica o redacta con eso, no de oído. La base vectorial no “entiende” contratos. Calcula qué fragmentos se parecen en significado a lo que escribiste. En este prototipo pide los 5 más cercanos (k = 5) y el modelo trabaja con eso.

Hay dos puertas, y las dos tocan el RAG, aunque de distinta forma.

- Documento. Dentro de un proyecto le pides que cree o cambie un borrador: ahí sí se modifica el contrato. Las cláusulas de siempre (comparecencia, renta, depósito, firmas) no las inventa el índice; están en plantillas JSON. El RAG entra cuando hace falta ley, sobre todo si pides un pacto que no está en el catálogo.
- Asistente legal (el círculo flotante). Preguntas libres —depósito, desalojo, quién repara—. Eso no cambia ningún borrador: responde con lo recuperado y muestra de qué archivo salió, con el score. Esta puerta es la que más se parece a `POST /query` del enunciado.

El mismo cableado serviría después con otro código, otro estado u otro tipo de documento. Cambiaría el contenido del bucket y, si hace falta, las plantillas. S3 → índice → Retrieve → modelo se sostiene.

2. El ciclo del curso y dónde vive cada capa

El enunciado plantea este ciclo en local:

```
Usuario → Streamlit → FastAPI → (embeddings de Google AI + Chroma + Gemini)
```

Aquí el ciclo no cambió —incrustar, indexar, recuperar los más cercanos y recién entonces generar—. Cambió el lugar donde vive cada capa:

```
Usuario → React (Vite en local, hosting en la nube)
       → HTTP API (API Gateway)              ≡ FastAPI
       → Lambda micasa-chat                  ≡ la capa de aplicación
            ├─ Retrieve (Knowledge Base)     ≡ Chroma: top-k
            ├─ embeddings al Sync            ≡ Google AI embeddings
            └─ Converse (Kimi K3 / Haiku)    ≡ Gemini: generar
Origen de archivos: S3                       ≡ data/
Persistencia del índice: Knowledge Base      ≡ chroma/
Estado de la app (no vectores): DynamoDB
```

No es una arquitectura “lejos” de la propuesta. Es la propuesta pasada al ecosistema AWS, usando S3 como origen y S3 Vectors / Knowledge Base como almacén de embeddings. La interfaz nunca habla con el índice ni con el modelo: solo hace HTTP. Eso es lo que el enunciado pide de Streamlit respecto a FastAPI.

3. Equivalencias (qué pedían y qué hace cada pieza aquí)

| Capa del enunciado | Tecnología pedida | Equivalente en este prototipo | Por qué cumple el rol |
|---|---|---|---|
| UI | Streamlit: preguntar y ver respuesta con citas | React + Vite. Chat del documento y asistente legal con fuentes | El usuario pregunta y ve la respuesta. La UI solo habla HTTP con el API. No llama a Bedrock ni a S3. |
| API | FastAPI: `GET /health`, `POST /query`, `POST /ingest` | Lambda `micasa-chat` detrás de API Gateway. Esas tres rutas existen, más las de proyectos y turnos del contrato | `/health` describe el servicio, el índice y k. `/query` es Retrieve + generar. `/ingest` no reindexa en el POST: se sube el PDF a S3 y se lanza Sync, que es el ingest de verdad. |
| Índice | Chroma persistente, chunks + metadatos, k-NN | Knowledge Base de Bedrock sobre el bucket de origen, búsqueda administrada, top-k = 5 | Chroma guarda vectores en disco; la KB los guarda en el índice administrado (S3 Vectors). Reiniciar la Lambda no borra el índice. Cada fragmento trae origen (el PDF en S3) y score. |
| Embeddings | Google AI, el mismo modelo para documentos y preguntas | Al hacer Sync, Bedrock parte los PDFs y pide embeddings al modelo de la KB. Al preguntar, la misma tubería vectoriza la consulta | El k-NN solo tiene sentido si pregunta y chunks viven en el mismo espacio. Eso lo garantiza la KB: no mezclo un embedder local con otro. |
| Generación | Gemini, en español, citar, abstenerse | Bedrock Converse: Kimi K3 (`us.moonshotai.kimi-k3`) y Claude 3.5 Haiku de respaldo. El contrato no lo escribe RetrieveAndGenerate | Primero se recupera, después se genera. El prompt del asistente dice: usa solo el contexto; si no alcanza, dilo y no inventes artículos. |

Piezas extra (no pedidas, no sustituyen el RAG): DynamoDB guarda hilos y borradores; las plantillas JSON sostienen la forma del contrato; el hosting del front es aparte. El RAG no depende de ellas para recuperar ley.

Por qué este camino y no Streamlit / Chroma / Google en el camino crítico. El enunciado permite librerías de apoyo y pide un sistema RAG programado, con UI, API, índice y embeddings. AWS publica el mismo patrón con S3 Vectors + Bedrock. Lo elegí para no mantener Chroma en un proceso local que se pierde entre máquinas, para no poner una `GOOGLE_API_KEY` en el cliente, y para demostrar ingestión real: archivos en S3 → Sync → Retrieve. Encima del RAG hay un producto usable (contratos), no solo un chat de chunks. El orden sigue siendo el del curso: primero recuperas, después generas.

4. Cómo se integran (de afuera hacia adentro)

```
Usuario (navegador)
    → App React (Vite)          pantalla; no duplica la lógica legal
    → HTTP API (API Gateway)    una sola puerta pública
    → Lambda micasa-chat        turnos, RAG, plantillas
         ├─ DynamoDB            proyectos, mensajes, slots, cláusulas
         ├─ S3                  origen del RAG (PDFs) y plantillas JSON
         ├─ Knowledge Base      Retrieve: busca en el índice vectorial
         └─ Bedrock Runtime     Converse: habla con el modelo
              └─ el índice se alimentó desde S3 al hacer Sync
```

Qué hace cada servicio, en la práctica:

- S3. Disco en la nube. Dos usos: (1) origen del RAG —los PDFs que se indexan—; (2) plantillas JSON del contrato.
- Knowledge Base. El bibliotecario. Toma los archivos de S3, los parte, calcula un vector por fragmento y los deja en una base vectorial administrada. En este prototipo la KB es `Q1UNTTTE8X`, sobre `micasa-kb-source`.
- Retrieve. La consulta al bibliotecario. Le mandas una frase; te regresa los fragmentos más cercanos. No genera texto.
- Converse. La llamada al modelo: extraer datos del mensaje, redactar un extra, responder el asistente, suavizar el tono.
- Lambda. Un proceso que se enciende por cada request. El código está en `infra/chat/` (Python).
- API Gateway. La URL pública. Una ruta proxy; el enrutamiento real vive dentro de la Lambda.
- DynamoDB. Documentos clave-valor. Conversación y estado del contrato. No es la base vectorial.
- IAM. Permisos: la Lambda puede leer plantillas, hacer Retrieve, invocar el modelo y escribir en Dynamo. Por eso no hay `GOOGLE_API_KEY` en git: en AWS eso va por rol.

S3 no es, por sí solo, la base vectorial. S3 guarda los archivos. Bedrock, al sincronizar la Knowledge Base, los embebe y los deja consultables. Cuando el código “consulta la base vectorial”, llama a Retrieve con `numberOfResults = 5`. No usamos RetrieveAndGenerate: eso dejaría que Bedrock escribiera el contrato entero. Separamos buscar y generar para no perder las plantillas ni los filtros.

5. Dominio, corpus, partición y abstención

Dominio. Derecho civil inmobiliario de Yucatán (arrendamiento y compraventa de vivienda). Cinco documentos distintos en el bucket, no un párrafo repetido: Código Civil del Estado (~3.4 MB; fuente principal de ley), un formato de arrendamiento, un contrato de estacionamiento, un modelo CANADEVI de preventa y un contrato de adhesión de PROFECO. k = 5. Embeddings: los de la Knowledge Base al Sync. Generación: Kimi K3. El Código Civil se descarga de https://www.yucatan.gob.mx/docs/pot/secogey/12_DAJYSP/2022/Fraccion_I/Codigo_Civil_del_Estado_de_Yucatan.pdf. Lista: `data/README.md`. Las plantillas `templates/*.json` no son el corpus legal; son la forma del contrato.

Cómo particioné. No corté yo los PDFs ni corrí un `chunk.py`. Al sincronizar, Bedrock los parte (tamaño fijo con overlap) y les pone metadatos de origen. Lo dejé así porque un corte a mano por N caracteres parte artículos a la mitad y luego Retrieve trae trozos sueltos. k = 5 alcanza para el artículo y lo que tiene al lado, sin llenar el contexto de ruido.

Cómo decido abstener. El asistente solo puede usar el contexto recuperado. Si no alcanza, lo dice y no inventa artículos ni cifras. Hay un filtro porque “depósito” en el Código es dos temas: fianza de renta (arts. 1619-1620) y guarda de bienes. Si la pregunta es de vivienda, se tiran los chunks del otro título. Si Retrieve no sirve, responde que no pudo con las fuentes (`abstained: true` en `POST /query`). No se rellena con lo que el modelo “recuerda”.

Qué haría Google AI y qué haría Chroma. En el enunciado, Google AI embebe y también genera (Gemini). Chroma guarda vectores y hace el k-NN. Aquí embeber lo hace el Sync de la KB; el cajón y el k-NN los hace Retrieve (persistente, top-5, con score); generar lo hace Converse después de buscar. No se pegan los chunks como si fueran la respuesta.

6. Plantillas vs RAG

Las cláusulas de siempre no las escribe el índice. Flujo cuando pides un contrato o un cambio:

1. El modelo extrae hechos (nombres, renta, “quiero no mascotas”).
2. Si el pedido cabe en el catálogo (`renta.json` / `venta.json` / `extras.json`), se pega esa cláusula. No se improvisa.
3. Si es un pacto nuevo, se hace Retrieve sobre el Código y recién entonces se redacta un extra, con filtros (no vía de hecho, no usura, etc.).
4. Dynamo guarda el estado; el navegador arma Word/PDF.

Si pides actualizar un dato (depósito, plazo), se rellena el slot de la plantilla. No se regenera la ley desde cero. El modelo no es dueño del contrato.

7. Cómo está el código

- `src/` — React 19 + Vite 8 + TypeScript. UI, PDF, Word. No duplica la lógica legal.
- `infra/chat/` — Lambda: `handler.py` (API + Retrieve + Converse, incluidas `/health`, `/query`, `/ingest`), `agent.py` (turno del documento), `clauses.py` (llenar plantillas), `compose.py` (extras y filtros), `wording.py`, `templates/*.json`.
- `infra/deploy.sh` — publica Lambda + HTTP API.
- `infra/iam-policy.json` — permisos de Retrieve, modelos, S3 de plantillas, Dynamo.
- `knowledge/` — notas de diseño; no son el índice.
- `data/README.md` — lista del corpus (los PDFs viven en S3, no en git).

El cerebro (modelo + RAG) no corre en la laptop. La app local le habla por HTTP al API ya desplegado.

8. Cómo correrlo si tienes el código

Node 22 (`nvm use`). Copia `.env.example` a `.env.local` y pega `VITE_API_URL`. `npm install` y `npm run dev`. Sin esa URL no hay chat ni RAG. No necesitas claves de AWS en el frontend.

Para una copia propia del backend hace falta cuenta en `us-east-1`, habilitar el modelo en Bedrock, un bucket de origen, una Knowledge Base apuntando a ese bucket, una tabla Dynamo y `bash infra/deploy.sh`. Quien clone el repo no lleva `.env.local` (está ignorado).

9. Límites

El índice es tan bueno como el PDF y el Sync. Un Retrieve por similitud puede traer el artículo equivocado si la palabra aparece en otro título; por eso hay filtros y plantillas. El login del prototipo no es autenticación de producción. No es un producto jurídico certificado: es un demostrador de RAG aplicado a un dominio real. Si se alimenta después con otros documentos, el valor sigue siendo el mismo: no pedirle al modelo que se acuerde de la ley; pedirle que la lea.
