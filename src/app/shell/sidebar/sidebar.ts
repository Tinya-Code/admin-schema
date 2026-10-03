import { Component, computed } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { allSchemas } from '../../schemas/registry';
import type { ResourceSchema } from '../../core/models/schema.model';

interface MenuEntry {
  id: string;
  label: string;
}

/**
 * Menú lateral generado desde el catálogo EFECTIVO (F7-4): locales
 * fusionados + recursos sintetizados del schema remoto — un recurso nuevo
 * del backend aparece acá con 0 cambios en `src/`. Reactivo a la señal del
 * schema remoto (el initializer lo resuelve antes del primer render, pero
 * el `computed` cubre el caso de respuesta tardía).
 * `labelPlural` + `permissions`: un recurso se oculta solo si declara
 * create, update y remove explícitamente en falso (no hay permiso de
 * lectura).
 */
@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <aside class="w-60 shrink-0 border-r border-neutral/20 bg-white">
      <div class="border-b border-neutral/20 px-5 py-4">
        <span class="font-display text-base font-semibold">Admin</span>
      </div>
      <nav aria-label="Principal" class="p-3">
        <ul class="space-y-1">
          @for (item of menuItems(); track item.id) {
            <li>
              <a
                [routerLink]="['/', item.id]"
                routerLinkActive="bg-primary/10 text-primary"
                class="block rounded-lg px-3 py-2 text-sm font-medium text-neutral hover:bg-neutral/10"
              >
                {{ item.label }}
              </a>
            </li>
          }
        </ul>
      </nav>
    </aside>
  `,
})
export class Sidebar {
  readonly menuItems = computed<MenuEntry[]>(() =>
    allSchemas()
      .filter(isVisible)
      .map((schema) => ({
        id: schema.id,
        label: schema.labelPlural,
      })),
  );
}

function isVisible(schema: ResourceSchema): boolean {
  const permissions = schema.permissions;
  if (!permissions) {
    return true;
  }
  return (
    permissions.create !== false || permissions.update !== false || permissions.remove !== false
  );
}
