import { HttpClient, HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, Observable } from 'rxjs';

import { API_URL } from '../tokens';

/**
 * Subida de imágenes al endpoint `/upload` (multipart, api.md §6, archivo
 * `Media`). Devuelve la URL pública `image_url`; el front solo guarda esa
 * URL (base.md §7 — la imagen anterior no se borra al reemplazar).
 */
@Service()
export class UploadService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);

  upload(file: File): Observable<string> {
    const form = new FormData();
    form.append('file', file, file.name);
    const url = `${this.apiUrl}?path=${encodeURIComponent('/upload')}`;
    return this.http
      .post<{ image_url: string }>(url, form)
      .pipe(map((response) => response.image_url));
  }

  /**
   * Misma subida con eventos de progreso (base.md §7, estado «Subiendo»):
   * emite `UploadProgress` y termina con `Response` llevando la URL en el
   * body. El campo sólo cambia cuando llega la respuesta.
   */
  uploadWithProgress(file: File): Observable<HttpEvent<string>> {
    const form = new FormData();
    form.append('file', file, file.name);
    const url = `${this.apiUrl}?path=${encodeURIComponent('/upload')}`;
    return this.http
      .post<{ image_url: string }>(url, form, { reportProgress: true, observe: 'events' })
      .pipe(
        map((event) => {
          if (event.type !== HttpEventType.Response) {
            return event;
          }
          return new HttpResponse({
            body: event.body?.image_url ?? '',
            status: event.status,
            statusText: event.statusText,
          });
        }),
      );
  }
}
