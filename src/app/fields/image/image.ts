import { HttpEventType } from '@angular/common/http';
import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';

import type { ImageField } from '../../core/models/schema.model';
import { ApiError } from '../../core/models/api.model';
import { NotificationService } from '../../core/services/notification.service';
import { UploadService } from '../../core/services/upload.service';

const BASE =
  'rounded-lg border border-neutral/30 px-3 py-2 text-sm font-medium hover:bg-neutral/5 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Carga de imagen (base.md §7): el valor es SOLO la URL pública.
 *
 * Control propio `FormValueControl<string>`: el nodo llega con `[formField]`
 * desde el despachador y el `id` lo pone el host sobre este elemento (mismo
 * patrón que `multiselect`), para que el `<label for>` del campo exista.
 *
 * Estados: vacío (zona punteada + arrastrar-soltar), subiendo (progreso; el
 * valor no cambia hasta la respuesta), con imagen (preview + Reemplazar /
 * Quitar / Ver en grande) y error (conserva la imagen anterior).
 */
@Component({
  selector: 'app-field-image',
  template: ` @if (error(); as message) {
      <p
        class="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        role="alert"
      >
        {{ message }}
      </p>
    }
    @if (uploading()) {
      <div class="rounded-xl border border-neutral/20 bg-white p-3" data-testid="image-uploading">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral/20">
          <div
            class="h-full rounded-full bg-primary transition-all"
            [style.width.%]="progress()"
          ></div>
        </div>
        <p class="mt-1 text-xs text-neutral">Subiendo… {{ progress() }}%</p>
      </div>
    } @else if (value()) {
      <div class="rounded-xl border border-neutral/20 bg-white p-3">
        <img
          [src]="value()"
          [alt]="''"
          [class]="previewClass()"
          [style.aspect-ratio]="aspectRatio()"
        />
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" class="{{ baseBtn }}" [disabled]="disabled()" (click)="pickFile()">
            Reemplazar
          </button>
          @if (!field().required) {
            <button type="button" class="{{ baseBtn }}" [disabled]="disabled()" (click)="clear()">
              Quitar
            </button>
          }
          <a
            class="text-sm font-medium text-primary hover:underline"
            [href]="value()"
            target="_blank"
            rel="noopener noreferrer"
          >
            Ver en grande
          </a>
        </div>
      </div>
    } @else {
      <div
        class="rounded-xl border-2 border-dashed border-neutral/30 p-6 text-center"
        (dragover)="$event.preventDefault()"
        (drop)="onDrop($event)"
      >
        <p class="text-sm text-neutral">Arrastrá una imagen acá</p>
        <button
          type="button"
          class="mt-2 {{ baseBtn }}"
          [disabled]="disabled()"
          (click)="pickFile()"
        >
          Subir imagen
        </button>
      </div>
    }

    <input
      #fileInput
      type="file"
      class="sr-only"
      [accept]="acceptAttr()"
      [disabled]="disabled()"
      (change)="onFileSelected($event)"
    />`,
})
export class FieldImage implements FormValueControl<string> {
  readonly field = input.required<ImageField>();
  /** Recurso dueño de la imagen (firma de subida: carpeta de Cloudinary, §11.2). */
  readonly resource = input('');

  /** Sincronizado por el directive `FormField` del host. */
  readonly value = model.required<string>();
  readonly disabled = input(false);
  /** Marca el campo como tocado (upload/clear/error), como el `blur` nativo. */
  readonly touch = output<void>();

  private readonly upload = inject(UploadService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly uploading = signal(false);
  protected readonly progress = signal(0);
  protected readonly error = signal<string | null>(null);

  /** Literal en el código: Tailwind v4 genera las clases al escanearlo. */
  protected readonly baseBtn = BASE;
  protected readonly previewClass = computed(
    () => `${this.field().previewSize ?? 'w-48'} rounded-lg object-cover`,
  );
  protected readonly aspectRatio = computed(() => this.field().aspectRatio ?? null);
  protected readonly acceptAttr = computed(() => this.field().accept ?? 'image/*');

  private fileInput?: HTMLInputElement;
  private uploadSub?: { unsubscribe(): void };

  protected pickFile(): void {
    this.fileInput?.click();
  }

  protected clear(): void {
    this.value.set('');
    this.error.set(null);
    this.touch.emit();
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Permite volver a elegir el mismo archivo tras un error.
    input.value = '';
    if (file) {
      this.startUpload(file);
    }
  }

  protected onDrop(event: Event): void {
    event.preventDefault();
    const file = (event as DragEvent).dataTransfer?.files?.[0];
    if (file) {
      this.startUpload(file);
    }
  }

  /** Valida en cliente (accept + maxSizeMB) y sube con progreso. */
  private startUpload(file: File): void {
    if (this.disabled()) {
      return;
    }
    const problem = this.validate(file);
    if (problem !== null) {
      this.error.set(problem);
      this.touch.emit();
      return;
    }
    this.error.set(null);
    this.uploading.set(true);
    this.progress.set(0);
    this.touch.emit();

    this.uploadSub?.unsubscribe();
    this.uploadSub = this.upload.uploadWithProgress(file, this.resource()).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          if (event.total) {
            this.progress.set(Math.round((event.loaded / event.total) * 100));
          }
          return;
        }
        if (event.type === HttpEventType.Response) {
          const url = event.body ?? '';
          this.uploading.set(false);
          if (url === '') {
            this.error.set('No se pudo subir la imagen.');
            return;
          }
          this.value.set(url);
          this.notifications.success('Imagen subida.');
        }
      },
      error: (err: unknown) => {
        this.uploading.set(false);
        // El backend explica el motivo (firma inválida, 429 rate-limit…).
        this.error.set(
          err instanceof ApiError
            ? err.message
            : 'No se pudo subir la imagen. Verificá la conexión e intentá de nuevo.',
        );
      },
    });
    this.destroyRef.onDestroy(() => this.uploadSub?.unsubscribe());
  }

  private validate(file: File): string | null {
    if (!file.type.startsWith('image/')) {
      return 'El archivo debe ser una imagen.';
    }
    const accept = this.field().accept;
    if (accept !== undefined && !acceptMatches(accept, file)) {
      return 'Formato no permitido para este campo.';
    }
    const maxSizeMB = this.field().maxSizeMB;
    if (maxSizeMB !== undefined && file.size > maxSizeMB * 1024 * 1024) {
      return `La imagen supera ${maxSizeMB} MB.`;
    }
    return null;
  }
}

/** `accept` de `<input type=file>`: lista, `image/*` o extensión `.png`. */
function acceptMatches(accept: string, file: File): boolean {
  for (const raw of accept.split(',')) {
    const entry = raw.trim().toLowerCase();
    if (entry === '') {
      continue;
    }
    if (entry.startsWith('.')) {
      if (file.name.toLowerCase().endsWith(entry)) {
        return true;
      }
    } else if (entry.endsWith('/*')) {
      if (file.type.startsWith(entry.slice(0, -1))) {
        return true;
      }
    } else if (file.type === entry) {
      return true;
    }
  }
  return false;
}
