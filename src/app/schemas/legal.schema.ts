import type { ResourceSchema } from '../core/models/schema.model';

/**
 * Singleton legal (libro de reclamaciones e IGV) — base.md §11, api.md §3.9.
 * `last_updated` lo rellena el script al guardar; acá solo se muestra.
 */
export const legalSchema: ResourceSchema = {
  id: 'legal',
  label: 'Legal',
  labelPlural: 'Legal',
  kind: 'singleton',
  endpoint: {
    get: '/admin/legal',
    update: '/admin/legal',
  },
  // Los singleton no tienen clave de registro; `get`/`update` no la usan.
  keyField: 'key',
  titleField: 'legal_name',
  listColumns: [],
  layout: {
    mode: 'sections',
    sections: [
      { id: 'empresa', label: 'Empresa' },
      { id: 'contacto', label: 'Contacto' },
      { id: 'tributario', label: 'Tributario' },
    ],
  },
  fields: [
    // ── Empresa ──
    {
      type: 'text',
      key: 'legal_name',
      label: 'Razón social',
      required: true,
      section: 'empresa',
      width: 6,
    },
    {
      type: 'text',
      key: 'trade_name',
      label: 'Nombre comercial',
      required: true,
      section: 'empresa',
      width: 6,
    },
    {
      type: 'text',
      key: 'ruc',
      label: 'RUC',
      required: true,
      help: '11 dígitos.',
      validators: { pattern: '^\\d{11}$' },
      section: 'empresa',
      width: 6,
    },
    {
      type: 'text',
      key: 'fiscal_address',
      label: 'Domicilio fiscal',
      required: true,
      section: 'empresa',
      width: 6,
    },
    {
      type: 'readonly-text',
      key: 'last_updated',
      label: 'Última actualización',
      required: true,
      readonly: true,
      format: 'date',
      help: 'Lo actualiza el servidor al guardar.',
      section: 'empresa',
      width: 6,
    },
    // ── Contacto ──
    {
      type: 'email',
      key: 'email',
      label: 'Correo de contacto',
      required: true,
      section: 'contacto',
      width: 6,
    },
    {
      type: 'phone',
      key: 'phone',
      label: 'Teléfono',
      required: true,
      format: 'e164',
      section: 'contacto',
      width: 6,
    },
    {
      type: 'email',
      key: 'reclamos_email',
      label: 'Correo del libro de reclamaciones',
      required: true,
      section: 'contacto',
      width: 6,
    },
    {
      type: 'number',
      key: 'reclamos_response_days',
      label: 'Días de respuesta',
      required: true,
      help: 'Días hábiles para responder al reclamo.',
      min: 0,
      section: 'contacto',
      width: 6,
    },
    // ── Tributario ──
    {
      type: 'boolean',
      key: 'prices_include_igv',
      label: 'Precios con IGV',
      required: true,
      default: true,
      trueLabel: 'Incluyen IGV',
      falseLabel: 'No incluyen IGV',
      section: 'tributario',
      width: 6,
    },
    {
      type: 'text',
      key: 'currency',
      label: 'Moneda',
      required: true,
      help: 'Código ISO 4217 (ej. PEN).',
      validators: { pattern: '^[A-Z]{3}$' },
      section: 'tributario',
      width: 6,
    },
  ],
};
