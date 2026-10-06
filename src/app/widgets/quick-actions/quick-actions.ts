import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideExternalLink,
  LucideFileText,
  LucidePlus,
  LucideSettings,
  LucideZap,
} from '@lucide/angular';

import type { QuickActionsWidget } from '../../core/models/schema.model';
import { parseNavigationUrl, type ParsedRoute } from '../../core/utils/template-interpolator';

const BUTTON_CLASSES: Record<string, string> = {
  primary:
    'bg-primary text-surface hover:bg-primary/90 font-medium px-4 py-2.5 rounded-lg inline-flex items-center gap-2 text-sm transition-colors',
  outline:
    'border border-neutral/40 bg-surface text-neutral hover:bg-neutral/10 font-medium px-4 py-2.5 rounded-lg inline-flex items-center gap-2 text-sm transition-colors',
  secondary:
    'bg-neutral/10 text-neutral-light hover:bg-neutral/20 font-medium px-4 py-2.5 rounded-lg inline-flex items-center gap-2 text-sm transition-colors',
};

/**
 * Grid de accesos directos y atajos operativos para el Dashboard.
 */
@Component({
  selector: 'app-quick-actions',
  imports: [RouterLink, LucidePlus, LucideSettings, LucideFileText, LucideExternalLink, LucideZap],
  template: `
    <article class="flex h-full flex-col rounded-xl border border-neutral/20 bg-surface p-4">
      <h2 class="mb-3 text-sm font-semibold text-neutral-light">{{ widget().label }}</h2>

      <div class="grid flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2">
        @for (action of widget().actions; track action.label) {
          @if (isExternal(action.navigateTo)) {
            <a
              [href]="action.navigateTo"
              target="_blank"
              rel="noopener noreferrer"
              [class]="buttonClass(action.variant)"
            >
              @switch (action.icon) {
                @case ('plus') {
                  <svg lucidePlus size="16" class="shrink-0" />
                }
                @case ('settings') {
                  <svg lucideSettings size="16" class="shrink-0" />
                }
                @case ('document') {
                  <svg lucideFileText size="16" class="shrink-0" />
                }
                @default {
                  <svg lucideExternalLink size="16" class="shrink-0" />
                }
              }
              <span class="truncate">{{ action.label }}</span>
            </a>
          } @else {
            <a
              [routerLink]="parseRoute(action.navigateTo).path"
              [queryParams]="parseRoute(action.navigateTo).queryParams"
              [class]="buttonClass(action.variant)"
            >
              @switch (action.icon) {
                @case ('plus') {
                  <svg lucidePlus size="16" class="shrink-0" />
                }
                @case ('settings') {
                  <svg lucideSettings size="16" class="shrink-0" />
                }
                @case ('document') {
                  <svg lucideFileText size="16" class="shrink-0" />
                }
                @default {
                  <svg lucideZap size="16" class="shrink-0" />
                }
              }
              <span class="truncate">{{ action.label }}</span>
            </a>
          }
        }
      </div>
    </article>
  `,
})
export class QuickActions {
  readonly widget = input.required<QuickActionsWidget>();

  protected isExternal(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  protected parseRoute(url: string): ParsedRoute {
    return parseNavigationUrl(url);
  }

  protected buttonClass(variant?: string): string {
    return BUTTON_CLASSES[variant || 'secondary'] || BUTTON_CLASSES['secondary'];
  }
}
