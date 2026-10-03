import { HttpEvent, HttpEventType } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';

import { ImageField } from '../../core/models/schema.model';
import { NotificationService } from '../../core/services/notification.service';
import { UploadService } from '../../core/services/upload.service';
import { FieldImage } from './image';

/**
 * Regresión del selector de imagen: `#fileInput` es una template ref y
 * Angular NO la auto-asigna a la propiedad de clase — con el campo
 * `fileInput` en `undefined`, `pickFile()` no abría nada. Cubre también el
 * arrastre en los dos estados (zona vacía y preview).
 */
describe('Campo imagen', () => {
  const NEW_URL = 'https://cdn.example.com/nueva.png';
  const uploadSpy = vi.fn((): Observable<HttpEvent<string>> =>
    of({ type: HttpEventType.Response, body: NEW_URL } as HttpEvent<string>),
  );
  const notifyStub = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

  beforeEach(async () => {
    uploadSpy.mockClear();
    notifyStub.success.mockClear();
    await TestBed.configureTestingModule({
      imports: [FieldImage],
      providers: [
        { provide: UploadService, useValue: { uploadWithProgress: uploadSpy } },
        { provide: NotificationService, useValue: notifyStub },
      ],
    }).compileComponents();
  });

  async function create(value: string) {
    const fixture = TestBed.createComponent(FieldImage);
    const field: ImageField = { key: 'image_url', label: 'Imagen', type: 'image' };
    fixture.componentRef.setInput('field', field);
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('resource', 'products');
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function buttons(fixture: { nativeElement: HTMLElement }): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button'));
  }

  function findButton(fixture: { nativeElement: HTMLElement }, text: string): HTMLButtonElement {
    const btn = buttons(fixture).find((b) => b.textContent?.includes(text));
    if (!btn) throw new Error(`No se encontró el botón «${text}»`);
    return btn;
  }

  function dispatchDrop(zone: Element, file: File): void {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
    zone.dispatchEvent(event);
  }

  const imageFile = (): File => new File(['x'], 'foto.png', { type: 'image/png' });

  it('el botón «Subir imagen» abre el selector de archivos', async () => {
    const fixture = await create('');
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});

    findButton(fixture, 'Subir imagen').click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('el botón «Reemplazar» abre el selector de archivos', async () => {
    const fixture = await create('https://cdn.example.com/vieja.png');
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});

    findButton(fixture, 'Reemplazar').click();

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('soltar una imagen en la zona vacía la sube y setea el valor', async () => {
    const fixture = await create('');
    const zone = fixture.nativeElement.querySelector('[data-testid="image-dropzone"]');
    expect(zone).not.toBeNull();

    dispatchDrop(zone!, imageFile());

    expect(uploadSpy).toHaveBeenCalledWith(imageFile(), 'products');
    expect(fixture.componentInstance.value()).toBe(NEW_URL);
    expect(notifyStub.success).toHaveBeenCalled();
  });

  it('soltar una imagen sobre el preview también la sube (reemplazo)', async () => {
    const fixture = await create('https://cdn.example.com/vieja.png');
    const preview = fixture.nativeElement.querySelector('[data-testid="image-preview"]');
    expect(preview).not.toBeNull();

    dispatchDrop(preview!, imageFile());

    expect(uploadSpy).toHaveBeenCalledWith(imageFile(), 'products');
    expect(fixture.componentInstance.value()).toBe(NEW_URL);
  });

  it('dragover se cancela por defecto (habilita el drop del navegador)', async () => {
    const fixture = await create('');
    const zone = fixture.nativeElement.querySelector('[data-testid="image-dropzone"]')!;
    const event = new Event('dragover', { bubbles: true, cancelable: true });

    zone.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
