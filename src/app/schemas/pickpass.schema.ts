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
      required: true,
      help: 'URL base del sitio público para generar enlaces de consulta (ej. https://retiro.miempresa.com).',
      section: 'general',
      width: 12,
    },
    {
      type: 'textarea',
      key: 'share_message_template',
      label: 'Plantilla de Mensaje para Compartir',
      required: true,
      rows: 3,
      help: 'Mensaje predeterminado al compartir por WhatsApp o enlace. Incluí {ref} para insertar el código del pedido.',
      section: 'general',
      width: 12,
    },
    {
      type: 'number',
      key: 'pin_ttl_hours',
      label: 'Tiempo de Vida del PIN (Horas)',
      required: true,
      default: 24,
      min: 1,
      max: 720,
      help: 'Duración en horas del PIN de seguridad generado para escrituras públicas.',
      section: 'seguridad',
      width: 6,
    },
    {
      type: 'select',
      key: 'pin_enabled',
      label: 'PIN de Seguridad Habilitado',
      required: true,
      default: 'SI',
      options: [
        { label: 'Sí', value: 'SI' },
        { label: 'No', value: 'NO' },
      ],
      section: 'seguridad',
      width: 6,
    },
  ],
};
