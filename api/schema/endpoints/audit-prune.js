// schema/endpoints/audit-prune — Poda de `_audit_log` por `retention` (R9.5.1, B14).
//
// `policies.audit.retention` (validate-registry) declara CUÁNTOS DÍAS vive
// cada fila de ese recurso en la traza. La declaración no poda nada: hacerlo
// en cada escritura sería trabajo extra dentro de cada request (O3), y
// Apps Script no tiene cron fiable dentro del runtime — los triggers de
// programación sólo se instalan desde el editor (R9.5.6).
//
// Así que la poda vive acá, al estilo de sheet-drift (R1.2): una ruta webapp
// SÍ es invocable desde Node, y `scripts/audit-prune.mjs` (`npm run
// audit:prune`) la corre en despliegue/operación, nunca por request.
//
//   payload { resource?: <id>, apply?: boolean }
//     resource → acota la poda a UN recurso; opcional.
//     apply    → false (default) = DRY-RUN: sólo cuenta. true = borra.
//
// Conservador por diseño: sólo borra filas cuyo `entity` declara retention
// Y cuya fecha se pudo leer; lo que no se puede datar o no está declarado,
// se queda. La propia poda además deja una fila de auditoría (action
// `prune`) — que, como no tiene retention declarada, nunca se poda a sí
// misma: el historial de podas es historia, no basura.

REGISTRY.endpoints.auditPrune = {
  route: '/admin/audit-prune',
  method: 'POST',
  access: 'admin',
  limits: '1/min',
  handler: 'handleAuditPrune',
  input: {
    resource: { type: 'text', required: false, maxLength: 64 },
    apply: { type: 'boolean', required: false },
  },
  output: {
    ok: { type: 'boolean', required: true },
    dryRun: { type: 'boolean', required: true },
    checked: { type: 'number', required: true },
    stale: { type: 'number', required: true },
    removed: { type: 'number', required: true },
  },
  errors: [
    {
      status: 400,
      description: 'Recurso desconocido o sin `policies.audit.retention` declarado.',
    },
  ],
  since: '1.0',
};
