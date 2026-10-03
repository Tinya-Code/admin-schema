import { categoriesSchema } from './categories.schema';
import { productsSchema } from './products.schema';
import { REMOTE_SCHEMA_RESPONSE } from './__fixtures__/remote-schema';
import {
  mergeResourceSchema,
  parseSchemaResponse,
  remoteToSchema,
  type RemoteResource,
} from './schema-merge';

/** Fixture real de `/admin/schema` (F7-4); null ⇒ el test corta, no se inventa. */
function fixture(): Record<string, RemoteResource> {
  const parsed = parseSchemaResponse(REMOTE_SCHEMA_RESPONSE);
  if (parsed === null) {
    throw new Error('el fixture remoto no parsea');
  }
  return parsed;
}

describe('schema-merge — metadatos públicos F7-1', () => {
  it('parsea la respuesta real: 4 locales + el recurso sólo-remoto', () => {
    expect(Object.keys(fixture()).sort()).toEqual([
      '_prueba',
      'categories',
      'legal',
      'products',
      'site',
    ]);
  });

  it('merge local-driven: presencia ⇒ manda, ausencia ⇒ conserva local', () => {
    const remote = fixture()['products'];
    expect(remote).toBeDefined();
    const merged = mergeResourceSchema(productsSchema, remote!);

    // endpoint derivado de operations (F7-1: rutas efectivas del backend)
    expect(merged.endpoint.list).toBe('/admin/products');
    expect(merged.endpoint.get).toBe('/admin/products/{key}');
    // metadatos públicos fusionados
    expect(merged.operations?.list?.shape?.envelope).toBe('list');
    expect(merged.operations?.list?.shape?.pick).toContain('brand');
    expect(merged.views?.['featured']?.limit).toBe(6);
    expect(merged.policies?.access).toEqual({ read: 'admin', write: 'admin' });

    // presentación local intacta (el backend no la publica)
    expect(merged.label).toBe(productsSchema.label);
    expect(merged.labelPlural).toBe(productsSchema.labelPlural);
    expect(merged.listColumns).toEqual(productsSchema.listColumns);
    expect(merged.layout).toEqual(productsSchema.layout);
    expect(merged.filters).toEqual(productsSchema.filters);
    // campos: mismo orden y claves que el local (merge por key)
    expect(merged.fields.map((field) => field.key)).toEqual(
      productsSchema.fields.map((field) => field.key),
    );
  });

  it('remoto sin las claves nuevas ⇒ el schema local queda intacto', () => {
    const soloModelo = {
      id: 'categories',
      kind: 'collection',
      keyField: 'slug',
      titleField: 'name',
      ordering: 'positioned',
      fields: [],
    };
    const merged = mergeResourceSchema(categoriesSchema, soloModelo);
    expect(merged.operations).toBeUndefined();
    expect(merged.views).toBeUndefined();
    expect(merged.policies).toBeUndefined();
    expect(merged.endpoint).toEqual(categoriesSchema.endpoint);
    expect(merged.fields.length).toBe(categoriesSchema.fields.length);
  });
});

describe('remoteToSchema — recurso sólo-remoto (F7-4)', () => {
  it('sintetiza un ResourceSchema completo desde la proyección', () => {
    const remote = fixture()['_prueba'];
    expect(remote).toBeDefined();
    const schema = remoteToSchema(remote!);
    expect(schema).toBeDefined();

    expect(schema!.id).toBe('_prueba');
    expect(schema!.label).toBe('Prueba');
    expect(schema!.labelPlural).toBe('Pruebas');
    expect(schema!.kind).toBe('collection');
    expect(schema!.keyField).toBe('slug');
    expect(schema!.titleField).toBe('name');
    expect(schema!.endpoint).toEqual({
      list: '/admin/_prueba',
      get: '/admin/_prueba/{key}',
      create: '/admin/_prueba',
      update: '/admin/_prueba/{key}',
      remove: '/admin/_prueba/{key}',
    });

    // listColumns desde operations.list.shape.pick, labels humanizados,
    // formato derivado del tipo (boolean ⇒ boolean)
    expect(schema!.listColumns).toEqual([
      { key: 'slug', label: 'Slug' },
      { key: 'name', label: 'Name' },
      { key: 'active', label: 'Active', format: 'boolean' },
    ]);

    // campos con label derivado; sin layout ⇒ FormView dibuja sin secciones
    expect(schema!.layout).toBeUndefined();
    expect(schema!.fields.map((field) => field.label)).toEqual(['Slug', 'Name', 'Active']);
    expect((schema!.fields[0] as { from?: string }).from).toBe('name');

    // metadatos públicos también presentes en el sintetizado
    expect(schema!.views?.['publicados']?.where?.[0]).toEqual({
      field: 'active',
      op: 'eq',
      value: true,
    });
    expect(schema!.views?.['destacados']).toEqual({ custom: true });
    expect(schema!.policies?.access).toEqual({ read: 'admin', write: 'admin' });
    // nada de permisos derivados: sin declaración ⇒ todo permitido
    expect(schema!.permissions).toBeUndefined();
  });

  it('defensivo: shapes rotos caen a nada, nunca lanzan', () => {
    expect(remoteToSchema({})).toBeUndefined();
    expect(remoteToSchema({ id: 'sin-fields' })).toBeUndefined();
    expect(remoteToSchema({ id: 'vacio', fields: [] })).toBeUndefined();

    const merged = mergeResourceSchema(categoriesSchema, {
      id: 'categories',
      fields: [],
      operations: 42,
      views: 'roto',
      policies: { access: { read: 7 } },
    });
    expect(merged.operations).toBeUndefined();
    expect(merged.views).toBeUndefined();
    expect(merged.policies).toBeUndefined();
  });
});
