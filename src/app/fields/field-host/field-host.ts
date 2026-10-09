import { Component, computed, input } from '@angular/core';

import type { FieldSchema } from '../../core/models/schema.model';
import { RenderHost, type RenderContext } from '../../core/registry/render-host';
import type { RootTree } from '../field-node';

/**
 * Entrada estable de los formularios (base.md §5).
 *
 * **R3.5 · ya no despacha.** Este host redujo sus 493 líneas —el `@switch`
 * de 20 ramas, los 21 imports a mano y el envoltorio de label/errores— a un
 * adaptador que traduce su API histórica (`field` + `tree` + `pathPrefix` …)
 * al `RenderContext` que espera `<app-render-host>`, el motor único de
 * render (F1 · `refactormotor.md`).
 *
 * El rótulo, las marcas required/opcional, el error, la ayuda,
 * `FIELD_ARIA` y la **recursión de `group`/`list`** (los `ng-template` con
 * `ngTemplateOutlet` y `ListChildContext`) viven ahora en `RenderHost`, que
 * se auto-importa para instanciar sus propios hijos.
 *
 * Rutas del backend: `pathPrefix` encadena el prefijo del contenedor
 * (`address.`, `faq[2].`) y `serverErrors` lleva el mapa completo; el error
 * propio de este campo se resuelve como `serverErrors[prefix + key]`.
 */
@Component({
  selector: 'app-field-host',
  imports: [RenderHost],
  template: `
    <app-render-host kind="field" [type]="field().type" [config]="field()" [ctx]="ctx()" />
  `,
})
export class FieldHost {
  readonly field = input.required<FieldSchema>();
  readonly tree = input.required<RootTree>();
  readonly exists = input(false);
  readonly serverErrors = input<Record<string, string>>({});
  readonly pathPrefix = input('');
  readonly resource = input('');

  protected readonly ctx = computed<RenderContext>(() => ({
    tree: this.tree(),
    serverErrors: this.serverErrors(),
    pathPrefix: this.pathPrefix(),
    exists: this.exists(),
    resource: this.resource(),
  }));
}
