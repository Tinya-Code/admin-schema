import { Component, computed, inject, input } from '@angular/core';

import { LucideCopy, LucideShare } from '@lucide/angular';

import { buildShareMessage, writeClipboard } from '../../../core/utils/clipboard';
import { NotificationService } from '../../../core/services/notification.service';
import { Button } from '../button/button';

/**
 * Copia el enlace de un registro al portapapeles y ofrece compartirlo.
 *
 * Es lo que hace útil `public_base_url` (Etapa 2, S5): con este botón el
 * operador entrega el enlace público del pedido.
 *
 * Tres caminos, todos degradando en vez de romper:
 *
 * 1. **Copiar** — `navigator.clipboard.writeText`; si el navegador no lo
 *    tiene (contexto no seguro) cae a un `textarea` + `execCommand('copy')`.
 * 2. **Compartir** — `navigator.share`, sólo renderizado si existe
 *    (`'share' in navigator`; no está en desktop).
 * 3. **WhatsApp** — el reemplazo del 2 cuando no hay `navigator.share`:
 *    `wa.me/?text=` con `shareText` + `url`.
 *
 * `navigator.share` se llama con `{ url, text }`: no se envía `title` porque
 * no hay input dedicado y `label` es el rótulo del botón de copiar, no un
 * título de compartir.
 */
@Component({
  selector: 'app-copy-share',
  imports: [Button, LucideCopy, LucideShare],
  template: `
    <div class="flex flex-wrap items-center gap-2">
      <button app-button type="button" variant="outline" (click)="copy()">
        <svg lucideCopy size="16" />
        {{ label() }}
      </button>

      @if (canShare()) {
        <button app-button type="button" variant="ghost" (click)="share()">
          <svg lucideShare size="16" />
          Compartir
        </button>
      } @else {
        <button app-button type="button" variant="ghost" (click)="shareWhatsApp()">
          <svg lucideShare size="16" />
          WhatsApp
        </button>
      }
    </div>
  `,
})
export class CopyShare {
  /** Enlace público a copiar/compartir. */
  readonly url = input.required<string>();
  /** Rótulo del botón de copiar. */
  readonly label = input('Copiar enlace');
  /** Texto que viaja junto al enlace al compartir (nativo o WhatsApp). */
  readonly shareText = input('');

  private readonly notify = inject(NotificationService);

  /**
   * El share nativo no existe en desktop: sin él se ofrece WhatsApp.
   *
   * Se comprueba `typeof … === 'function'` y no `'share' in navigator` como
   * dice el plan: el `in` da `true` también para una propiedad propia con
   * valor `undefined` (polyfills y stubs hacen exactamente eso), y eso
   * montaría un botón que revienta al pulsarlo.
   */
  protected readonly canShare = computed(
    () => typeof navigator !== 'undefined' && typeof navigator.share === 'function',
  );

  protected readonly waUrl = computed(() => {
    // Mismo texto que copia el botón: `buildShareMessage` evita pegar el
    // enlace DOS veces cuando el `shareTextTemplate` ya lo trae escrito.
    const text = buildShareMessage(this.url(), this.shareText());
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
  });

  protected async copy(): Promise<void> {
    // El mensaje formateado completo (saludo + ref + enlace + PIN), no sólo
    // la URL: es lo que el operador pega en la conversación con el cliente.
    const copied = await writeClipboard(buildShareMessage(this.url(), this.shareText()));
    if (copied) {
      this.notify.success('Mensaje copiado.');
    } else {
      this.notify.error('No se pudo copiar el mensaje.');
    }
  }

  protected async share(): Promise<void> {
    if (!this.canShare()) {
      this.shareWhatsApp();
      return;
    }
    try {
      await navigator.share({ url: this.url(), text: this.shareText() });
    } catch {
      // Cancelar la hoja de compartir dispara AbortError: no es un error.
    }
  }

  protected shareWhatsApp(): void {
    window.open(this.waUrl(), '_blank', 'noopener,noreferrer');
  }
}
