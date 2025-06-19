# Git Sync

Herramienta de línea de comandos en Node.js para crear y mantener una copia de un proyecto local.
Permite sincronizar directorios respetando las reglas de `.gitignore` y puede subir la copia a un
repositorio privado en GitHub.

## Instalación

1. Clona este repositorio.
2. Ejecuta `npm install` para instalar las dependencias listadas en `package.json`.

## Configuración

Copia el archivo `.env.example` a `.env` y completa las variables:

- `GITHUB_TOKEN`: token personal de GitHub con permiso `repo` si se desea subir la copia.
- `PROJECT_PATH`: ruta absoluta del proyecto principal que se sincronizará.
- `DESTINATION_PATH`: carpeta base donde se creará la copia.

## Uso

Ejecuta el script con:

```bash
node index.js
```

o, en Windows, con `run.bat`.

Si es la primera vez que se ejecuta y la copia no existe, se realizará una copia inicial de todos
los archivos que no estén ignorados por `.gitignore`. Al finalizar se ofrece la opción de crear un
repositorio privado en GitHub y subir la copia.

Tras la copia inicial se mostrará un menú interactivo con varias acciones de sincronización:

1. **Sincronizar principal → copia una vez**.
2. **Sincronizar principal → copia descartando cambios locales y haciendo push**.
3. **Sincronizar copia → principal una vez**.
4. **Eliminar archivos extra en la copia** (respeta los `.gitignore`).

Las funciones de sincronización consideran cualquier `.gitignore` encontrado a lo largo del
proyecto para decidir qué archivos copiar o eliminar.

## Dependencias

- Node.js (probado con la versión mostrada en `.nvmrc` o similar).
- Paquetes npm: `@octokit/rest`, `dotenv`, `fs-extra`, `ignore`, `recursive-copy`, `rimraf`.

Instala todo con `npm install`.

## Licencia

Este proyecto no especifica una licencia.

