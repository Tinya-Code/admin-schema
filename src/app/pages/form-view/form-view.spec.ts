import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../../core/services/api.service';
import { ErrorMapperService } from '../../core/services/error-mapper.service';
import { NotificationService } from '../../core/services/notification.service';
import { UploadService } from '../../core/services/upload.service';
import { FieldHost } from '../../fields/field-host/field-host';
import { FormView } from './form-view';

/**
 * Regresión: la rama `@else` del layout (secciones colapsables en `<details>`,
 * p. ej. `site`) renderizaba `<app-field-host>` SIN `[resource]` — el campo
 * imagen subía con `resource: ''` y el backend respondía 400
 * «Falta resource (p. ej. products)» (upload-signature.js).
 */
describe('FormView — resource hacia field-host', () => {
  async function createSiteForm() {
    await TestBed.configureTestingModule({
      imports: [FormView],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ id: 'site' })) },
        },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        {
          provide: ApiService,
          useValue: {
            get: vi.fn(() => of({})),
            create: vi.fn(() => of({})),
            update: vi.fn(() => of({})),
            remove: vi.fn(() => of({})),
          },
        },
        {
          provide: NotificationService,
          useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
        },
        {
          provide: ErrorMapperService,
          useValue: { map: vi.fn(() => ({ fields: {} })), messageOf: vi.fn(() => '') },
        },
        { provide: UploadService, useValue: { uploadWithProgress: vi.fn(() => of()) } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(FormView);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('pasa el id del recurso a todos los field-host (rama details incluida)', async () => {
    const fixture = await createSiteForm();

    // La rama problemática es la de secciones colapsables: si no renderiza,
    // el test no estaría cubriendo el fix.
    expect(fixture.nativeElement.querySelector('details')).not.toBeNull();

    const hosts = fixture.debugElement.queryAll(By.directive(FieldHost));
    expect(hosts.length).toBeGreaterThan(0);

    for (const host of hosts) {
      expect(host.componentInstance.resource()).toBe('site');
    }
  });
});
