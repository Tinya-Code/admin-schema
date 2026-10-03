import type { ResourceSchema } from '../core/models/schema.model';

/**
 * Singleton de configuración del sitio — base.md §11, api.md §3.6–§3.8.
 * La API aplana `address_street` etc. a objetos anidados al responder.
 */
export const siteSchema: ResourceSchema = {
  id: 'site',
  label: 'Sitio',
  labelPlural: 'Sitio',
  kind: 'singleton',
  endpoint: {
    get: '/admin/site',
    update: '/admin/site',
  },
  // Los singleton no tienen clave de registro; `get`/`update` no la usan.
  keyField: 'key',
  titleField: 'name',
  // Sin listado: `listColumns` queda vacío por tipo.
  listColumns: [],
  layout: {
    mode: 'sections',
    sections: [
      { id: 'negocio', label: 'Negocio' },
      { id: 'contacto', label: 'Contacto' },
      { id: 'direccion', label: 'Dirección' },
      { id: 'horarios', label: 'Horarios' },
      { id: 'redes', label: 'Redes' },
    ],
  },
  fields: [
    // ── Negocio ──
    {
      type: 'text',
      key: 'name',
      label: 'Nombre del negocio',
      required: true,
      section: 'negocio',
      width: 6,
    },
    {
      type: 'url',
      key: 'url',
      label: 'Sitio web',
      required: true,
      section: 'negocio',
      width: 6,
    },
    {
      type: 'textarea',
      key: 'description',
      label: 'Descripción',
      required: true,
      rows: 4,
      section: 'negocio',
      width: 12,
    },
    {
      type: 'text',
      key: 'currency',
      label: 'Moneda',
      required: true,
      default: 'PEN',
      help: 'Código ISO 4217 (ej. PEN).',
      validators: { pattern: '^[A-Z]{3}$' },
      section: 'negocio',
      width: 6,
    },
    // ── Contacto ──
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
      type: 'phone',
      key: 'whatsapp',
      label: 'WhatsApp',
      required: true,
      format: 'digits',
      help: 'Solo dígitos, sin +.',
      section: 'contacto',
      width: 6,
    },
    {
      type: 'email',
      key: 'email',
      label: 'Correo',
      required: true,
      section: 'contacto',
      width: 6,
    },
    // ── Dirección (grupos address y geo) ──
    {
      type: 'group',
      key: 'address',
      label: 'Dirección',
      required: true,
      display: 'card',
      section: 'direccion',
      width: 12,
      fields: [
        { type: 'text', key: 'street', label: 'Calle', required: true },
        { type: 'text', key: 'city', label: 'Ciudad', required: true },
        { type: 'text', key: 'region', label: 'Región', required: true },
        { type: 'text', key: 'postal_code', label: 'Código postal', required: true },
        {
          type: 'text',
          key: 'country',
          label: 'País',
          required: true,
          help: 'ISO alpha-2 (ej. PE).',
          validators: { pattern: '^[A-Z]{2}$' },
        },
      ],
    },
    {
      type: 'group',
      key: 'geo',
      label: 'Coordenadas',
      required: true,
      display: 'card',
      section: 'direccion',
      width: 12,
      fields: [
        {
          type: 'number',
          key: 'lat',
          label: 'Latitud',
          required: true,
          min: -90,
          max: 90,
          decimals: 6,
        },
        {
          type: 'number',
          key: 'lng',
          label: 'Longitud',
          required: true,
          min: -180,
          max: 180,
          decimals: 6,
        },
      ],
    },
    // ── Horarios ──
    {
      type: 'list',
      key: 'hours',
      label: 'Horarios',
      positionField: 'position',
      addLabel: 'Agregar tramo',
      emptyText: 'Sin horarios definidos.',
      itemFields: [
        {
          type: 'multiselect',
          key: 'days',
          label: 'Días',
          required: true,
          options: [
            { value: 'mon', label: 'Lunes' },
            { value: 'tue', label: 'Martes' },
            { value: 'wed', label: 'Miércoles' },
            { value: 'thu', label: 'Jueves' },
            { value: 'fri', label: 'Viernes' },
            { value: 'sat', label: 'Sábado' },
            { value: 'sun', label: 'Domingo' },
          ],
        },
        { type: 'time', key: 'opens', label: 'Abre', required: true },
        { type: 'time', key: 'closes', label: 'Cierra', required: true },
      ],
      section: 'horarios',
      width: 12,
    },
    // ── Redes ──
    {
      type: 'string-list',
      key: 'social',
      label: 'Redes sociales',
      itemType: 'url',
      addLabel: 'Agregar red',
      emptyText: 'Sin redes sociales.',
      section: 'redes',
      width: 12,
    },
  ],
};
