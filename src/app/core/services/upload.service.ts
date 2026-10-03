import { HttpClient, HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, Observable, switchMap } from 'rxjs';

import { ApiService } from './api.service';

/** Firma que emite `/admin/upload-signature` (baseapi §11.3). NUNCA `api_secret`. */
interface UploadSignature {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  signature: string;
  folder: string;
  allowed_formats: string;
  upload_url: string;
}

/** Respuesta de Cloudinary en un upload normal (sólo interesa `secure_url`). */
interface CloudinaryResponse {
  secure_url?: unknown;
}

/**
 * Subida de imágenes en DOS PASOS (baseapi §11.2, opción B):
 *  1. Firma firmada por el backend → `POST /admin/upload-signature`
 *     con `{ resource }` (mismo envelope text/plain que todo `/admin/*`).
 *  2. El navegador sube directo a Cloudinary (FormData a `upload_url`) con
 *     los parámetros que fijó y firmó el backend; el API secret jamás sale
 *     de acá (§11.1–§11.3).
 *
 * Se guarda SOLO `secure_url` (base.md §7: la URL pública es el valor del
 * campo; la imagen anterior no se borra al reemplazar — §11.6).
 *
 * Los errores (firma caducada, rate-limit 429, red) llegan por el canal de
 * error; el componente conserva la imagen anterior (§11.2 paso 6).
 */
@Service()
export class UploadService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(ApiService);

  /**
   * Misma subida con eventos de progreso (base.md §7, estado «Subiendo»):
   * emite `UploadProgress` durante la subida a Cloudinary y termina con
   * `Response` llevando la URL en el body. El campo sólo cambia cuando
   * llega la respuesta.
   */
  uploadWithProgress(file: File, resource: string): Observable<HttpEvent<string>> {
    return this.api.request<UploadSignature>('POST', '/admin/upload-signature', { resource }).pipe(
      switchMap((signature) => {
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('api_key', signature.api_key);
        form.append('timestamp', String(signature.timestamp));
        form.append('signature', signature.signature);
        form.append('folder', signature.folder);
        form.append('allowed_formats', signature.allowed_formats);
        return this.http.post<CloudinaryResponse>(signature.upload_url, form, {
          reportProgress: true,
          observe: 'events',
        });
      }),
      map((event) => {
        if (event.type !== HttpEventType.Response) {
          return event;
        }
        const url = typeof event.body?.secure_url === 'string' ? event.body.secure_url : '';
        return new HttpResponse({
          body: url,
          status: event.status,
          statusText: event.statusText,
        });
      }),
    );
  }
}
