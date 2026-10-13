import { HttpEvent, HttpEventType } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';

import { FileField } from '../../core/models/schema.model';
import { NotificationService } from '../../core/services/notification.service';
import { UploadService } from '../../core/services/upload.service';
import { FieldFile } from './file';

/**
 * R9.5.3 — campo `file`: espejo de `FieldImage` para cualquier archivo.
 * Cubre el selector (template ref), el drop en los dos estados, la
 * validación de `accept`/`maxSizeMB` y el nombre derivado de la URL.
 */
describe('Campo archivo', () => {
  const NEW_URL = 'https://cdn.example.com/v1/produccion/adjuntos/informe_2024.pdf';
  const uploadSpy = vi.fn((): Observable<HttpEvent<string>> =>
    of({ type: HttpEventType.Response, body: NEW_URL } as HttpEvent<string>),
  );
  const notifyStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

  beforeEach(async () => {
    uploadSpy.mockClear();
    notifyStub.success.mockClear();
    await TestBed.configureTestingModule({
      imports: [FieldFile],
      providers: [
        { provide: UploadService, useValue: { uploadWithProgress: uploadSpy } },
        { provide: NotificationService, useValue: notifyStub },
      ],
    }).compileComponents();
  });

  async function create(value: string, overrides: Partial<FileField> = {}) {
    const fixture = TestBed.createComponent(FieldFile);
    const field: FileField = { key: 'adjunto', label: 'Adjunto', type: 'file', ...overrides };
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('resource', 'orders');
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function findButton(fixture: { nativeElement: HTMLElement }, text: string): HTMLButtonElement {
    const btn = Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(text),
    );
    if (!btn) throw new Error(`No se encontró el botón «${text}»`);
    return btn;
  }

  function dispatchDrop(zone: Element, file: File): void {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
    zone.dispatchEvent(event);
  }

  const pdfFile = (): File => new File(['x'], 'informe.pdf', { type: 'application/pdf' });

  it('el botón «Subir archivo» abre el selector de archivos', async () => {
    const fixture = await create('');
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});

    findButton(fixture, 'Subir archivo').click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('soltar un archivo lo sube pasando el nombre del campo (formats por campo)', async () => {
    const fixture = await create('');
    const zone = fixture.nativeElement.querySelector('[data-testid="file-dropzone"]');
    expect(zone).not.toBeNull();

    dispatchDrop(zone!, pdfFile());

    expect(uploadSpy).toHaveBeenCalledWith(pdfFile(), 'orders', 'adjunto');
    expect(fixture.componentInstance.value()).toBe(NEW_URL);
    expect(notifyStub.success).toHaveBeenCalled();
  });

  it('el preview muestra el nombre derivado de la URL y el enlace «Abrir»', async () => {
    const fixture = await create(NEW_URL);

    expect(fixture.nativeElement.textContent).toContain('informe_2024.pdf');
    const link = fixture.nativeElement.querySelector('a[target="_blank"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(NEW_URL);
  });

  it('un archivo fuera de `accept` se rechaza en cliente sin subir', async () => {
    const fixture = await create('', { accept: '.pdf' });
    const zone = fixture.nativeElement.querySelector('[data-testid="file-dropzone"]')!;

    dispatchDrop(zone, new File(['x'], 'foto.png', { type: 'image/png' }));
    fixture.detectChanges();

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Formato no permitido');
  });

  it('un archivo que supera `maxSizeMB` se rechaza en cliente sin subir', async () => {
    // ~0,104 bytes: el archivo de 1 byte ya la supera.
    const fixture = await create('', { maxSizeMB: 0.0000001 });
    const zone = fixture.nativeElement.querySelector('[data-testid="file-dropzone"]')!;

    dispatchDrop(zone, pdfFile());
    fixture.detectChanges();

    expect(uploadSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('supera');
  });

  it('«Quitar» vacía el campo (campo no requerido)', async () => {
    const fixture = await create(NEW_URL);

    findButton(fixture, 'Quitar').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('');
    expect(fixture.nativeElement.querySelector('[data-testid="file-dropzone"]')).not.toBeNull();
  });

  it('dragover se cancela por defecto (habilita el drop del navegador)', async () => {
    const fixture = await create('');
    const zone = fixture.nativeElement.querySelector('[data-testid="file-dropzone"]')!;
    const event = new Event('dragover', { bubbles: true, cancelable: true });

    zone.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
