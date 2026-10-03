import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { NotificationService } from './core/services/notification.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('crea la app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renderiza el outlet y el contenedor de toasts', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
    expect(compiled.querySelector('app-toast')).toBeTruthy();
  });

  it('muestra en pantalla el mensaje cuando el servicio notifica un éxito', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    TestBed.inject(NotificationService).success('Registro creado.');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const toast = compiled.querySelector('app-toast');
    expect(toast?.textContent).toContain('Registro creado.');
    // El toast vive fuera del router-outlet: sobrevive a la navegación
    // posterior a un create (form-view navega al listado).
    expect(compiled.querySelector('router-outlet + app-toast')).toBeTruthy();
  });
});
