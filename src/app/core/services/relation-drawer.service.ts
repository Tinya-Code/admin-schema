import { Service, signal } from '@angular/core';

/** Pedido de «Crear nuevo» lanzado desde el dropdown de una relación. */
export interface RelationCreateRequest {
  /** Recurso a crear (el `resource` de la relación). */
  resource: string;
  /**
   * Se invoca con la clave recién creada. Vive en la relación porque es ella
   * la que tiene que recargar sus opciones y preseleccionar el valor.
   */
  onCreated: (key: string) => void;
}

/**
 * Puente entre el control `relation` y el drawer que abre el formulario.
 *
 * Existe como señal inyectable y NO como un `output()` encadenado porque el
 * camino directo — `relation → DrawerForm → FieldHost → relation` — arma un
 * ciclo de imports de módulos: `field-host` se decoraría con
 * `FieldRelation === undefined` y Angular tiraría `Cannot read properties of
 * undefined (reading 'ɵcmp')`. El campo no puede importar un componente que,
 * a su vez, lo importa a él.
 *
 * Sólo hay un drawer a la vez, así que una única señal alcanza: quien lo
 * abre lo cierra con `clear()` al recibir `close`/`saved`.
 */
@Service()
export class RelationDrawerService {
  private readonly pending = signal<RelationCreateRequest | null>(null);

  /** Pedido en curso; `null` cuando no hay panel abierto. */
  readonly request = this.pending.asReadonly();

  open(resource: string, onCreated: (key: string) => void): void {
    this.pending.set({ resource, onCreated });
  }

  clear(): void {
    this.pending.set(null);
  }
}
