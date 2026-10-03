import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { REMOTE_SCHEMA_RESPONSE } from '../../schemas/__fixtures__/remote-schema';
import { parseSchemaResponse } from '../../schemas/schema-merge';
import { setRemoteSchema } from '../../schemas/registry';
import { Sidebar } from './sidebar';

describe('Sidebar — menú desde el catálogo efectivo (F7-4)', () => {
  afterEach(() => setRemoteSchema(null));

  it('con schema remoto: locales + el recurso sólo-remoto, en orden', async () => {
    setRemoteSchema(parseSchemaResponse(REMOTE_SCHEMA_RESPONSE));
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(Sidebar);
    await fixture.whenStable();
    fixture.detectChanges();

    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('nav a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Categorías',
      'Productos',
      'Sitio',
      'Legal',
      'Pruebas', // _prueba: sintetizado en 0 cambios de src/
    ]);
    expect(links[4].getAttribute('href')).toBe('/_prueba');
  });

  it('sin schema remoto (fallback): sólo los 4 locales', async () => {
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(Sidebar);
    await fixture.whenStable();
    fixture.detectChanges();

    const labels = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('nav a')).map(
      (a) => a.textContent?.trim(),
    );
    expect(labels).toEqual(['Categorías', 'Productos', 'Sitio', 'Legal']);
  });
});
