import { Component, computed, inject, input, resource, signal } from '@angular/core';
import { FormField } from '@angular/forms/signals';

import { LucidePlus } from '@lucide/angular';

import type { RelationField, SelectOption } from '../../core/models/schema.model';
import { DataSourceService, dataSourceKey } from '../../core/services/data-source.service';
import { RelationDrawerService } from '../../core/services/relation-drawer.service';
import { optionsFromRows } from '../../core/utils/source-options';
import { Button } from '../../shared/components/button/button';
import { getSchema } from '../../schemas/registry';
import { Skeleton } from '../../shared/components/skeleton/skeleton';
import { FieldAria } from '../field-aria';
import { childTree, type RootTree } from '../field-node';

/**
 * Referencia a otro recurso (base.md §5.2): `<select>` con opciones del
 * listado del recurso destino, cargadas desde `field.source` (F8 · R6.5).
 *
 * La vuelta no la arma este componente: pasa por `DataSourceService`, que
 * centraliza la caché por `resource+view+params`. El `resource()` de Angular
 * de acá sólo aporta el estado (loading/error/recarga), y su `params` es la
 * clave de la fuente ya interpolada — así una relación con `params`
 * dependientes del formulario se recarga cuando cambia el dato, y una sin
 * `params` no se entera de las teclas.
 *
 * Más de 7 opciones → búsqueda encima del select (plan 6.1, guía §1). Se
 * filtra un `<select>` nativo y no se construye un combobox propio: conserva
 * la navegación con teclado del navegador, el valor seleccionado visible y
 * la lista de opciones accesible sin gestionar `aria-activedescendant`.
 */
@Component({
  selector: 'app-field-relation',
  imports: [Button, FieldAria, FormField, LucidePlus, Skeleton],
  template: `
    @switch (optionsResource.status()) {
      @case ('loading') {
        <!-- El output es labelable: el for del label del host sigue teniendo
             ancla, y como ya es live region anuncia la carga. El skeleton
             reemplaza al texto con animate-pulse (plan 6.7). -->
        <output class="block" [id]="state().name()" aria-busy="true">
          <app-skeleton [lines]="1" [height]="40" />
          <span class="sr-only">Cargando opciones…</span>
        </output>
      }
      @case ('error') {
        <!-- Output en vez de un párrafo: es labelable (el label del host
             tiene ancla) y ya es live region, así que con role=alert el
             fallo de carga se anuncia sin repetir el texto en otro nodo. -->
        <output class="field-input block text-danger" [id]="state().name()" role="alert">
          No se pudieron cargar las opciones.
        </output>
      }
      @default {
        @if (useSearch()) {
          <!-- Guía §1: más de 7 opciones → dropdown con búsqueda. El filtro
               no reemplaza al select, lo acota; así el teclado y el valor
               elegido siguen funcionando igual. -->
          <input
            type="search"
            class="mb-1 w-full rounded-lg border border-neutral/30 bg-surface px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            placeholder="Buscar…"
            aria-label="Buscar entre las opciones"
            [attr.aria-controls]="state().name()"
            [value]="query()"
            (input)="onQuery($event)"
          />
        }
        <select class="field-input" [id]="state().name()" [formField]="node()">
          @if (!field().required) {
            <option value="">{{ field().placeholder ?? '— Seleccionar —' }}</option>
          }
          @for (option of visibleOptions(); track option.value) {
            <option [value]="option.value">{{ option.label }}</option>
          }
        </select>
        @if (noMatches()) {
          <p class="mt-1 text-xs text-neutral" role="status">
            Sin resultados para «{{ query() }}».
          </p>
        } @else if (options().length === 0) {
          <p class="mt-1 text-xs text-neutral">Sin opciones disponibles.</p>
        }
        @if (targetSchema() !== undefined && canCreate()) {
          <!-- Un <option> no puede contener un botón: la acción va justo
               debajo del control, pegada al dropdown. -->
          <button
            app-button
            variant="ghost"
            type="button"
            class="mt-1 -ml-2"
            (click)="requestCreate()"
          >
            <svg lucidePlus size="16" />
            Crear nuevo
          </button>
        }
      }
    }
  `,
})
export class FieldRelation {
  readonly field = input.required<RelationField>();
  readonly tree = input.required<RootTree>();

  private readonly ds = inject(DataSourceService);
  private readonly drawer = inject(RelationDrawerService);

  protected readonly node = computed(() => childTree<string>(this.tree(), this.field().key));
  protected readonly state = computed(() => this.node()());

  /** Texto escrito en el buscador (sólo se usa si supera el umbral). */
  protected readonly query = signal('');

  protected readonly targetSchema = computed(() => getSchema(this.field().source.resource));

  protected readonly canCreate = computed(() => this.targetSchema()?.permissions?.create !== false);

  /** Umbral de la guía §1: 5–7 opciones dropdown simple, más de 7 con búsqueda. */
  protected readonly useSearch = computed(() => this.options().length > 7);

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /**
   * Opciones que coinciden con el término de búsqueda, SIN conservar la
   * elegida. Es la base del mensaje «Sin resultados».
   */
  protected readonly matches = computed<SelectOption[]>(() => {
    const all = this.options();
    const term = this.query().trim().toLowerCase();
    if (term === '') {
      return all;
    }
    return all.filter((option) => option.label.toLowerCase().includes(term));
  });

  /** El buscador está activo y no encontró nada nuevo (el elegido no cuenta). */
  protected readonly noMatches = computed(
    () => this.useSearch() && this.query().trim() !== '' && this.matches().length === 0,
  );

  /**
   * Opciones que se dibujan. Con búsqueda activa se acotan por etiqueta,
   * PERO la opción elegida se conserva siempre: si desapareciera del DOM el
   * select dejaría de mostrar el valor actual (guía §1: «valor seleccionado
   * siempre visible»). Por eso no se dibuja a partir de `matches`.
   */
  protected readonly visibleOptions = computed<SelectOption[]>(() => {
    const filtered = this.matches();
    if (this.query().trim() === '') {
      return filtered;
    }
    const selected = String(this.state().value() ?? '');
    if (filtered.some((option) => option.value === selected)) {
      return filtered;
    }
    const kept = this.options().find((option) => option.value === selected);
    return kept === undefined ? filtered : [...filtered, kept];
  });

  /**
   * Pide el panel de «Crear nuevo». El servicio guarda el callback que, al
   * confirmarse la creación, recarga las opciones y preselecciona la clave.
   */
  protected requestCreate(): void {
    const resource = this.field().source.resource;
    this.drawer.open(resource, (key) => {
      // La fila nueva todavía no está en la caché compartida: sin este
      // `invalidate` la recarga devolvería la lista vieja (F8 · R6.5).
      this.ds.invalidate(resource);
      this.optionsResource.reload();
      // Se setea DESPUÉS de pedir la recarga: si la opción todavía no está
      // en el DOM el select mostraría vacío, y al llegar se reengancha sola
      // (visibleOptions conserva la elegida aunque el filtro la oculte).
      this.node()().value.set(key);
    });
  }

  /**
   * Registro del formulario, sólo para resolver `{campo}` en `source.params`.
   *
   * Si la fuente no declara parámetros el registro NO se lee: la relación
   * no depende del formulario y no se recalcula con cada tecla.
   */
  private readonly registro = computed<Record<string, unknown> | undefined>(() =>
    this.field().source.params === undefined ? undefined : this.tree()().value(),
  );

  /** Clave de la fuente ya interpolada: es lo que `resource` compara. */
  private readonly claveFuente = computed(() =>
    dataSourceKey(this.field().source, this.registro()),
  );

  /**
   * Carga de las opciones. `resource()` sólo aporta estado (loading/error/
   * recarga): la vuelta y la caché son del `DataSourceService`, que así
   * comparte filas con el resto de consumidores de la misma fuente.
   */
  private readonly optionsResource = resource({
    params: () => this.claveFuente(),
    loader: async () => this.ds.rows(this.field().source, this.registro()),
  });

  /**
   * Opciones (F8): filas de la fuente declarada → `SelectOption`.
   *
   * El `@switch` del template sólo entra en `default` cuando no hubo fallo,
   * pero el estado se mira acá también: `value()` del resource TIRA en
   * estado error (contract de Angular) y un computed que se evalúe por otra
   * vía tiraría el render entero.
   */
  protected readonly options = computed<SelectOption[]>(() =>
    this.optionsResource.status() === 'error'
      ? []
      : optionsFromRows(this.optionsResource.value() ?? [], {
          source: this.field().source,
          target: this.targetSchema(),
          onlyActive: this.field().onlyActive,
          secondaryField: this.field().secondaryField,
        }),
  );
}
