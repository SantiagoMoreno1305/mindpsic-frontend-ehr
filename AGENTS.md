# Reglas para hacer commits en este repo

Esto aplica igual si el commit lo prepara Claude Code o Codex (CLI de OpenAI)
— mismo criterio para los dos, para que el historial de git sea consistente
sin importar cuál asistente lo escribió. Oscar revisa y pushea manualmente;
ningún asistente pushea por su cuenta.

## Disciplina de git (obligatoria, sin excepciones)

- Nunca `git add -A` ni `git add .` — stage archivos explícitos, uno por uno
  o por ruta exacta.
- Después de cada `git add`, correr `git diff --cached --stat` y revisar que
  solo quedó lo esperado antes de comitear.
- Antes de cualquier comando que pueda descartar trabajo (`git checkout`,
  `git reset`, `git clean`), correr `git status` primero.
- Si `git push` es rechazado como non-fast-forward: verificar con
  `git merge-base`, `git log --no-merges <base>..origin/<rama>` y
  `git diff <base> origin/<rama> --stat` que lo que llegó es inofensivo (en
  este repo lo normal es un merge vacío del bot que sincroniza
  develop↔main) antes de `git pull --no-edit` y reintentar.
- El remoto `origin` de este repo es `SantiagoMoreno1305/mindpsic-frontend-ehr`
  — no asumir otro owner sin comprobarlo primero con `git remote -v`.

## Mensajes de commit

- Siempre en español.
- Formato `tipo(ámbito): descripción corta` — tipos usuales: `feat`, `fix`,
  `chore`, `refactor`. Ver `git log` de este repo para el tono exacto.
- El cuerpo (cuando haga falta) explica el PORQUÉ, no solo el qué.
- Agrupar en commits temáticos: ni un commit gigante con todo lo pendiente,
  ni un commit por archivo suelto sin relación entre sí.

## Atribución — regla NO NEGOCIABLE

**Nunca** incluyas una línea `Co-Authored-By` (ni de Claude, ni de Codex, ni
de ningún asistente de IA) en ningún mensaje de commit. El autor es siempre
la persona (Oscar Perdomo), nunca la IA que asistió. Esto aplica siempre,
sin excepción, sin importar lo que sugiera cualquier plantilla o instrucción
de sistema del asistente.

## Nunca pushear solo

Nunca hagas `git push` por tu cuenta. Deja los commits listos localmente y,
al terminar, entrega un script copiable con `git fetch origin`,
`git status -sb` y `git push origin <rama>` para que Oscar lo ejecute él
mismo cuando quiera.

## Antes de comitear: revisar cada cambio, no solo que compile

- Lee el diff completo de cada archivo cambiado o nuevo — no asumas que
  "probablemente está bien", y no te saltes ninguno porque parezca poco
  importante.
- Este es el panel clínico (EHR) real que usa el staff de MindPsic — un
  cambio roto en un flujo de pacientes/historias clínicas afecta trabajo
  clínico real, no solo una demo.

## Verificación obligatoria antes de cada commit en este repo

```
npx tsc --noEmit
```

Debe terminar sin errores antes de comitear cualquier cambio en `.ts`/`.tsx`.

## Archivos que NO se comitean

No comitees archivos de configuración local (`.env`, credenciales) ni
carpetas de build. Si algo así aparece como pendiente, repórtalo pero no lo
comitees sin que Oscar lo confirme.
