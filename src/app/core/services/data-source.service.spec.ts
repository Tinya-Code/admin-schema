import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DataSource } from '../models/schema.model';
import { getSchema } from '../../schemas/registry';
import { ApiService } from './api.service';
import { DataSourceService, dataSourceKey, interpolateParams } from './data-source.service';

/** Filas mínimas: el motor no impone forma a las columnas. */
const FILAS = [
  { slug: 'bebidas', name: 'Bebidas', active: true },
  { slug: 'pan', name: 'Pan', active: false },
];

describe('DataSourceService', () => {
  const listSpy = vi.fn();

  beforeEach(async () => {
    listSpy.mockReset();
    listSpy.mockImplementation(() => of([...FILAS]));
    await TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: { list: listSpy } }],
    }).compileComponents();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const ds = (): DataSourceService => TestBed.inject(DataSourceService);

  // ── interpolateParams ──────────────────────────────────────────────────

  describe('interpolateParams', () => {
    it('resuelve {campo} contra el contexto', () => {
      expect(interpolateParams({ categoria: '{slug}' }, { slug: 'bebidas' })).toEqual({
        categoria: 'bebidas',
      });
    });

    it("un valor que se resuelve vacío se OMITE (no viaja `''`)", () => {
      // Mandar `''` haría que el back comparara contra filas realmente
      // vacías: el parámetro ausente es fail-closed, el vacío no.
      expect(interpolateParams({ categoria: '{slug}', origen: 'manual' }, {})).toEqual({
        origen: 'manual',
      });
      expect(interpolateParams({ categoria: '{slug}' }, { slug: null })).toEqual({});
    });

    it('sin params devuelve objeto vacío y no explota con contexto ausente', () => {
      expect(interpolateParams(undefined)).toEqual({});
      expect(interpolateParams({ categoria: '{slug}' })).toEqual({});
    });
  });

  // ── dataSourceKey ──────────────────────────────────────────────────────

  describe('dataSourceKey', () => {
    const base: DataSource = { resource: 'categories', view: 'activos' };

    it('la clave es resource|view|params con las claves ordenadas', () => {
      expect(dataSourceKey({ ...base, params: { b: '2', a: '1' } })).toBe(
        'categories|activos|a=1&b=2',
      );
      // Mismo pedido, distinto orden de escritura ⇒ MISMA entrada de caché.
      expect(dataSourceKey({ ...base, params: { a: '1', b: '2' } })).toBe(
        dataSourceKey({ ...base, params: { b: '2', a: '1' } }),
      );
    });

    it('un {campo} que cambia es OTRA clave', () => {
      const source: DataSource = { resource: 'orders', params: { cliente: '{dni}' } };
      expect(dataSourceKey(source, { dni: '1' })).not.toBe(dataSourceKey(source, { dni: '2' }));
    });

    it('una view distinta es otra clave; sin view queda el hueco', () => {
      expect(dataSourceKey({ resource: 'categories' })).toBe('categories||');
      expect(dataSourceKey({ resource: 'categories', view: 'activos' })).toBe(
        'categories|activos|',
      );
    });
  });

  // ── rows: payload, caché y errores ─────────────────────────────────────

  describe('rows', () => {
    const source: DataSource = { resource: 'categories', view: 'activos' };

    it('pide el endpoint del recurso con { view, params } declarados', async () => {
      await ds().rows({ ...source, params: { orden: 'asc' } });
      expect(listSpy).toHaveBeenCalledTimes(1);
      // El servicio resuelve el id contra el registry y manda SU endpoint:
      // el componente nunca arma una URL.
      expect(listSpy).toHaveBeenCalledWith(getSchema('categories')!.endpoint, {
        view: 'activos',
        params: { orden: 'asc' },
      });
    });

    it('sin view ni params manda payload vacío (lectura llana)', async () => {
      await ds().rows({ resource: 'categories' });
      expect(listSpy).toHaveBeenCalledWith(getSchema('categories')!.endpoint, {});
    });

    it('la misma clave se pide UNA vez (caché por resource+view+params)', async () => {
      await ds().rows(source);
      await ds().rows(source);
      await ds().rows({ resource: 'categories', view: 'activos' });
      expect(listSpy).toHaveBeenCalledTimes(1);
    });

    it('parámetros resueltos distintos ⇒ otra vuelta', async () => {
      const conParam: DataSource = { resource: 'orders', params: { cliente: '{dni}' } };
      await ds().rows(conParam, { dni: '1' });
      await ds().rows(conParam, { dni: '2' });
      expect(listSpy).toHaveBeenCalledTimes(2);
    });

    it('`fresh` salta la caché (recarga tras una escritura)', async () => {
      await ds().rows(source);
      await ds().rows(source, undefined, true);
      expect(listSpy).toHaveBeenCalledTimes(2);
    });

    it('pasado el TTL vuelve a pedir (frescura, no inmortalidad)', async () => {
      vi.useFakeTimers();
      await ds().rows(source);
      vi.advanceTimersByTime(30_001);
      await ds().rows(source);
      expect(listSpy).toHaveBeenCalledTimes(2);
    });

    it('un error NO queda cacheado: el siguiente intento vuelve a pedir', async () => {
      listSpy.mockImplementationOnce(() => throwError(() => new Error('503')));
      await expect(ds().rows(source)).rejects.toThrow('503');
      await ds().rows(source);
      expect(listSpy).toHaveBeenCalledTimes(2);
    });

    it('una respuesta que no es lista llega como [] (el consumidor decide)', async () => {
      listSpy.mockImplementationOnce(() => of({ items: FILAS }));
      await expect(ds().rows(source)).resolves.toEqual([]);
    });

    it('un id inexistente es error de configuración y NO pide a la red', async () => {
      await expect(ds().rows({ resource: 'fantasma' })).rejects.toThrow(
        'Recurso desconocido: fantasma',
      );
      expect(listSpy).not.toHaveBeenCalled();
    });
  });

  // ── invalidate ─────────────────────────────────────────────────────────

  describe('invalidate', () => {
    it('sin argumento vacía toda la caché', async () => {
      await ds().rows({ resource: 'categories' });
      await ds().rows({ resource: 'products' });
      ds().invalidate();
      await ds().rows({ resource: 'categories' });
      await ds().rows({ resource: 'products' });
      expect(listSpy).toHaveBeenCalledTimes(4);
    });

    it('con resourceId sólo tira las de ESE recurso (prefijo de clave)', async () => {
      await ds().rows({ resource: 'categories' });
      await ds().rows({ resource: 'products' });
      ds().invalidate('categories');
      await ds().rows({ resource: 'categories' });
      await ds().rows({ resource: 'products' });
      expect(listSpy).toHaveBeenCalledTimes(3);
    });
  });
});
