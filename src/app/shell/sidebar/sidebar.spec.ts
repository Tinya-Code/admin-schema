import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Sidebar } from './sidebar';

describe('Sidebar — menú desde el catálogo estático', () => {
  it('lista los recursos del catálogo, en orden, con sus hrefs', async () => {
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(Sidebar);
    await fixture.whenStable();
    fixture.detectChanges();

    const links = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('nav a'));
    expect(links.map((a) => a.textContent?.trim())).toEqual([
      'Dashboard',
      'Categorías',
      'Productos',
      'Pedidos',
      'Configuración PickPass',
      'Sitio',
      'Legal',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/dashboard',
      '/categories',
      '/products',
      '/orders',
      '/pickpass',
      '/site',
      '/legal',
    ]);
  });
});
