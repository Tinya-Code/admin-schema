import { HttpEventType } from '@angular/common/http';
import {
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';

import type { FileField } from '../../core/models/schema.model';
import { ApiError } from '../../core/models/api.model';
import { NotificationService } from '../../core/services/notification.service';
import { Button } from '../../shared/components/button/button';
import { UploadService } from '../../core/services/upload.service';

/**
 * Carga de archivo (base.md §7 · R9.5.3): el valor es SOLO la URL pública,
 * igual que `image`, pero para cualquier tipo de archivo (pdf, xlsx, zip…).
 *
 * Espejo de `FieldImage` (D27: es un control propio que no pasa por
 * `NgComponentOutlet`, porque su `value` es un `model()` que el host
 * sincroniza por `[formField]`). La ÚNICA diferencia de comportamiento: no
 * fuerza el prefijo `image/` — el catálogo de formatos lo define el backend
 * por campo (`formats` declarado) o la lista global, y el cliente sólo
 * respeta `accept`/`maxSizeMB` como validación de comodidad.
 *
 * Estados: vacío (zona punteada + arrastrar-soltar), subiendo (progreso; el
 * valor no cambia hasta la respuesta), con archivo (nombre + Quitar / Ver) y
 * error (conserva el archivo anterior).
 */
@Component({
  selector: 'app-field-file',
  imports: [Button],
  template: ` @if (error(); as message) {
      <p
        class="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        role="alert"
      >
        {{ message }}
      </p>
    }
    @if (uploading()) {
      <div class="rounded-xl border border-neutral/20 bg-surface p-3" data-testid="file-uploading">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-neutral/20">
          <div
            class="h-full rounded-full bg-primary transition-all"
            [style.width.%]="progress()"
          ></div>
        </div>
        <p class="mt-1 text-xs text-neutral">Subiendo… {{ progress() }}%</p>
      </div>
    } @else if (value()) {
      <div
        class="rounded-xl border border-neutral/20 bg-surface p-3"
        data-testid="file-preview"
        (dragover)="$event.preventDefault()"
        (drop)="onDrop($event)"
      >
        <p class="truncate text-sm font-medium" [title]="value()">{{ fileName() }}</p>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            app-button
            variant="outline"
            [disabled]="disabled()"
            (click)="pickFile()"
          >
            Reemplazar
          </button>
          @if (!field().required) {
            <button
              type="button"
              app-button
              variant="outline"
              [disabled]="disabled()"
              (click)="clear()"
            >
              Quitar
            </button>
          }
          <a
            class="text-sm font-medium text-primary hover:underline"
            [href]="value()"
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir
          </a>
        </div>
      </div>
    } @else {
      <div
        class="rounded-xl border-2 border-dashed border-neutral/30 p-6 text-center"
        data-testid="file-dropzone"
        (dragover)="$event.preventDefault()"
        (drop)="onDrop($event)"
      >
        <p class="text-sm text-neutral">Arrastrá un archivo acá</p>
        <button
          type="button"
          app-button
          variant="outline"
          class="mt-2"
          [disabled]="disabled()"
          (click)="pickFile()"
        >
          Subir archivo
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
export class FieldFile implements FormValueControl<string> {
  readonly field = input.required<FileField>();
  /** Recurso dueño del archivo (firma de subida: carpeta de Cloudinary, §11.2). */
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

  /**
   * Nombre derivado de la URL para el preview. Cloudinary guarda el
   * `public_id` al final del path (…/v123/produccion/adjuntos/archivo_xyz):
   * lo presentable es el sufijo tras el último `/`, sin extensión ruidosa.
   */
  protected readonly fileName = computed(() => {
    const url = this.value();
    const segment = url.split('/').pop() ?? url;
    return decodeURIComponent(segment);
  });

  /** `accept` de `<input type=file>`: el declarado o `''` (sin forzar `image/*`). */
  protected readonly acceptAttr = computed(() => this.field().accept ?? '');

  /**
   * Template ref `#fileInput`: Angular NO auto-asigna las template refs a
   * propiedades de clase (mismo motivo que en `FieldImage`).
   */
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private uploadSub?: { unsubscribe(): void };

  protected pickFile(): void {
    this.fileInput().nativeElement.click();
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
    // El nombre del campo viaja siempre: si declara `formats`, el backend
    // firma ESA lista; sin formatos firma la lista global (R9.5.3).
    this.uploadSub = this.upload
      .uploadWithProgress(file, this.resource(), this.field().key)
      .subscribe({
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
              this.error.set('No se pudo subir el archivo.');
              return;
            }
            this.value.set(url);
            this.notifications.success('Archivo subido.');
          }
        },
        error: (err: unknown) => {
          this.uploading.set(false);
          // El backend explica el motivo (firma inválida, 429 rate-limit…).
          this.error.set(
            err instanceof ApiError
              ? err.message
              : 'No se pudo subir el archivo. Revisa la conexión e inténtalo de nuevo.',
          );
        },
      });
    this.destroyRef.onDestroy(() => this.uploadSub?.unsubscribe());
  }

  private validate(file: File): string | null {
    const accept = this.field().accept;
    if (accept !== undefined && accept !== '' && !acceptMatches(accept, file)) {
      return 'Formato no permitido para este campo.';
    }
    const maxSizeMB = this.field().maxSizeMB;
    if (maxSizeMB !== undefined && file.size > maxSizeMB * 1024 * 1024) {
      return `El archivo supera ${maxSizeMB} MB.`;
    }
    return null;
  }
}

/** `accept` de `<input type=file>`: lista, `tipo/*` o extensión `.png`. */
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
