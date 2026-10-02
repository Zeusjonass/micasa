# MiCasa

App para armar **borradores de contratos de vivienda en Yucatán**: renta o compraventa. Platicas con un agente, el borrador se escribe en el centro, y puedes editarlo a mano, aceptar o rechazar cambios, y bajarlo en Word o PDF.

No es un despacho ni sustituye a un abogado. El texto sale marcado como borrador informativo.

Hay dos usos distintos:

1. **Documento** — dentro de un proyecto abres un borrador y le pides al agente que lo cree o lo cambie. Aquí sí se modifica el contrato.
2. **Asistente legal** — el círculo flotante. Preguntas libres sobre la ley (depósito, desalojo, etc.). Eso **no** cambia ningún borrador.

Login local: `admin` / `admin`.

---

## Cómo se alimenta el RAG (y para qué sirve)

RAG = el modelo **no se inventa la ley de memoria**. Primero busca trozos del Código Civil de Yucatán que ya indexamos, y luego responde o arma cláusulas con eso.

```
Archivos de ley  →  Knowledge Base de Bedrock  →  Lambda busca trozos  →  el modelo los usa
```

**De dónde salen los textos.** En AWS hay un Knowledge Base de Bedrock. Ese índice se llena con los archivos del Código Civil (y lo que se le haya subido) que viven en el bucket de origen de la KB. Cuando alguien actualiza esos archivos y **sincroniza** la Knowledge Base, las respuestas empiezan a usar el texto nuevo. El id de la KB y el bucket están en `infra/deploy.sh` y `infra/chat/handler.py`; no hace falta copiarlos a otro lado.

**Para qué se usa.**

- En el **asistente**: cada pregunta dispara una búsqueda, se filtran trozos que no vienen al caso (por ejemplo, no confundir el depósito de la renta con el contrato de depósito de bienes) y el modelo contesta solo con ese contexto. Abajo salen las fuentes.
- En el **documento**: si pides una cláusula extra (mascotas, reparaciones, etc.), se busca otra vez en la KB para citar artículos de verdad, no de oído.

**Qué no es el RAG.** Las plantillas fijas del contrato (comparecencia, renta, depósito, firmas…) no salen del RAG. Están en `infra/chat/templates/`. El RAG aporta la ley; las plantillas aportan la forma del contrato.

**Si quieres cambiar lo que “sabe” la ley.** Sube o reemplaza los PDFs/textos en el bucket de origen de la KB y lanza un sync en la consola de Bedrock (Knowledge bases → la KB de MiCasa → Sync). Quien no tenga acceso a esa cuenta de AWS no puede alimentar el índice; el código solo lo **consulta**.

---

## Probar en local

Con el código de este repo alcanza para el frontend. El cerebro (modelo, RAG, contratos) corre en AWS; la app local le habla por HTTP.

Necesitas:

- **Node 22** (hay `.nvmrc`; `nvm use` basta)
- La **URL del API** ya desplegado. Copia `.env.example` a `.env.local` y pega `VITE_API_URL`. Si alguien ya corrió `infra/deploy.sh` en esta máquina, la URL queda en `infra/.api-url`. Si clonaste el repo en otra computadora, pide esa URL: no viaja en git (`.env.local` y `infra/.api-url` están ignorados).
- **No** necesitas claves de AWS ni Bedrock para usar la UI contra el API que ya existe.

```bash
nvm use
npm install
cp .env.example .env.local   # luego pega VITE_API_URL
npm run dev
```

Abre http://localhost:5173/ → `admin` / `admin`.

Qué probar:

1. Crea un proyecto y un borrador.
2. Usa un ejemplo del chat (renta o compraventa) y revisa que el documento coincida con lo que pediste.
3. Edita un párrafo o el pie (aviso, cierre, firmas) y recarga: debe seguir ahí.
4. Abre el círculo del asistente, pregunta por el depósito de la renta y mira que las fuentes hablen de arrendamiento, no de guarda de bienes.

**Qué no puedes hacer solo con el código.** No hay un Bedrock “de mentira” en tu laptop. Sin la URL del API no hay chat ni RAG. Para cambiar el modelo, redesplegar Lambda o resincronizar la KB sí ocupas acceso AWS a la cuenta de MiCasa y, si tocas infra, el perfil que usa `infra/deploy.sh`.

Modelo: el default del código es **Claude 3.5 Haiku**. Hoy está encendido **Kimi K3** (`us.moonshotai.kimi-k3`) con `USE_KIMI_NOW=1` en `infra/deploy.sh`. Para quitarlo: pon `USE_KIMI_NOW=0` y deja `MODEL_ID` / `FALLBACK_MODEL_ID` en Haiku, luego `bash infra/deploy.sh`.

---

## Forma del repo

- `src/` — React (Vite). Solo UI; no duplica la lógica legal.
- `infra/chat/` — Lambda: turnos del documento, asistente, RAG, plantillas.
- `infra/deploy.sh` — publica Lambda + HTTP API.
