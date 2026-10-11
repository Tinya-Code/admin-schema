import type { ResourceSchema } from '../core/models/schema.model';

export const pickpassSchema: ResourceSchema = {
  id: 'pickpass',
  label: 'Configuración PickPass',
  labelPlural: 'Configuración PickPass',
  kind: 'singleton',
  endpoint: {
    get: '/admin/pickpass',
    update: '/admin/pickpass',
  },
  keyField: 'key',
  titleField: 'public_base_url',
  listColumns: [],
  layout: {
    mode: 'sections',
    sections: [
      { id: 'general', label: 'Enlace Público y Mensaje' },
      { id: 'seguridad', label: 'Seguridad y PIN' },
    ],
  },
  fields: [
    {
      type: 'url',
      key: 'public_base_url',
      label: 'URL Base Pública',
      required: true, // los templates de share lo interpolan como {public_base_url}
      help: 'URL base del sitio público para generar enlaces de consulta (ej. https://retiro.miempresa.com).',
      section: 'general',
      width: 12,
    },
    {
      type: 'textarea',
      key: 'share_message_template',
      label: 'Plantilla de Mensaje para Compartir',
      required: true,
      rows: 3, // mensaje multi-línea de WhatsApp
      default:
        'Hola {customer_name}, puede retirar su pedido {ref} aquí: {public_base_url}/p/{ref}. Su PIN es {pin}.',
      // Los chips insertan el marcador donde está el cursor; el operador
      // escribe y arma el mensaje sin memorizar claves. El motor resuelve
      // cada {clave} contra config + registro del pedido (interpolateTemplate).
      tokens: [
        { key: 'customer_name', label: 'Nombre del cliente' },
        { key: 'ref', label: 'Código del pedido' },
        { key: 'pin', label: 'PIN' },
        { key: 'pickup_date', label: 'Fecha de retiro' },
        { key: 'status', label: 'Estado' },
        { key: 'public_base_url', label: 'Enlace público' },
      ],
      help: 'Mensaje que se copia al compartir. Usa los botones para insertar valores; el enlace público se agrega solo si falta.',
      section: 'general',
      width: 12,
    },
    {
      type: 'number',
      key: 'pin_ttl_hours',
      label: 'Tiempo de Vida del PIN (Horas)',
      required: true,
      default: 24, // un día: cobertura del retiro sin PIN eterno
      min: 1,
      max: 720, // un mes: tope superior razonable
      // D12 (R8.9): `pin-verify` compara created_at + este TTL contra now y
      // rechaza vencidos; también rechaza ENTREGADO/CANCELADO.
      help: 'Duración en horas del PIN de retiro: pasado ese plazo deja de verificar.',
      section: 'seguridad',
      width: 6,
    },
    {
      type: 'select',
      key: 'pin_enabled',
      label: 'PIN de Seguridad Habilitado',
      required: true,
      default: 'SI', // el retiro verificado es el caso por defecto del negocio
      options: [
        { label: 'Sí', value: 'SI' },
        { label: 'No', value: 'NO' },
      ],
      // D12: en `No`, `pin-verify` responde 404 «no hay PIN configurado» —
      // el mismo código que ya maneja la app pública cuando un pedido no
      // exige PIN, así el contrato externo no cambia (R8.5).
      help: 'En No, el público no necesita PIN para verificar un pedido.',
      section: 'seguridad',
      width: 6,
    },
  ],
};
