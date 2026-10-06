// schema/endpoints/events.js — Reporte de eventos de uso del navegador (Fase 6).
//
// POST /admin/events → handleEvents
// Acceso 'admin': los eventos vienen del panel interno, no del cliente final.
// Rate-limit declarativo: 60/min (señal de uso, no acción crítica).
//
// ⚠️ Los eventos reportados por el cliente NUNCA son fuente de verdad de estado
// (A4.13). Son señal de _uso_; el _estado_ lo da `_audit_log`.

REGISTRY.endpoints.events = {
  route: '/admin/events',
  method: 'POST',
  access: 'admin',
  limits: '60/min',
  handler: 'handleEvents',
};
