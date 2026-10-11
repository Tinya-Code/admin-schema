import { Component, EnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';

import type { TextareaField } from '../../core/models/schema.model';
import { type RootTree } from '../field-node';
import { FieldTextarea } from './textarea';

/**
 * El anfitrión NO lleva `[formField]`: `FieldTextarea` delega en el
 * `<textarea>` nativo de su propio template y ahí es donde vive la directiva
 * `FormField`. Pasarla en el host revienta con NG01914 («host must be a
 * native form control»). El host sólo monta el campo y le da el `tree`
 * (mismo criterio que `multiselect.spec.ts`, salvo que ese campo sí es
 * control propio con `model()`).
 */
@Component({
  template: `<app-field-textarea [field]="field" [tree]="tree" />`,
  imports: [FieldTextarea],
})
class Host {
  field!: TextareaField;
  tree!: RootTree;
}

describe('Campo textarea', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  async function create(field: TextareaField, initial = '') {
    const fixture = TestBed.createComponent(Host);
    const model = signal<Record<string, unknown>>({ [field.key]: initial });
    const tree = form(model, () => {}, {
      injector: TestBed.inject(EnvironmentInjector),
    }) as unknown as RootTree;
    fixture.componentInstance.field = field;
    fixture.componentInstance.tree = tree;
    fixture.detectChanges();
    return { fixture, model };
  }

  const area = (fixture: { nativeElement: HTMLElement }) =>
    fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;

  const chips = (fixture: { nativeElement: HTMLElement }): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid="textarea-tokens"] button'));

  const PLANTILLA: TextareaField = {
    type: 'textarea',
    key: 'share_message_template',
    label: 'Plantilla',
    tokens: [
      { key: 'ref', label: 'Código del pedido' },
      { key: 'pin', label: 'PIN' },
    ],
  };

  it('sin tokens no pinta la fila de chips', async () => {
    const { fixture } = await create({ type: 'textarea', key: 'msg', label: 'Msg' });
    expect(chips(fixture)).toHaveLength(0);
  });

  it('con tokens pinta un chip por token, con el rótulo humano', async () => {
    const { fixture } = await create(PLANTILLA);
    const labels = chips(fixture).map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Código del pedido', 'PIN']);
  });

  it('inserta {key} al final cuando el textarea está vacío', async () => {
    const { fixture, model } = await create(PLANTILLA);
    chips(fixture)[0].click();
    fixture.detectChanges();
    expect(model()[PLANTILLA.key]).toBe('{ref}');
  });

  it('inserta el token en la posición del cursor, no al final', async () => {
    const { fixture, model } = await create(PLANTILLA, 'Hola ');
    const a = area(fixture);
    // Cursor justo después de "Hola ".
    a.setSelectionRange(6, 6);
    chips(fixture)[1].click();
    fixture.detectChanges();
    expect(model()[PLANTILLA.key]).toBe('Hola {pin}');
  });

  it('reemplaza la selección con el token', async () => {
    const { fixture, model } = await create(PLANTILLA, 'borrar-esto');
    const a = area(fixture);
    a.setSelectionRange(0, 11);
    chips(fixture)[0].click();
    fixture.detectChanges();
    expect(model()[PLANTILLA.key]).toBe('{ref}');
  });

  it('devuelve el foco al textarea tras insertar', async () => {
    const { fixture } = await create(PLANTILLA);
    chips(fixture)[0].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.ownerDocument.activeElement).toBe(area(fixture));
  });

  it('acumula varios tokens escribiendo entre clics', async () => {
    const { fixture, model } = await create({ ...PLANTILLA, key: 'm' });
    chips(fixture)[0].click();
    fixture.detectChanges();
    // Escribir " con PIN " después del primer token.
    const a = area(fixture);
    a.setSelectionRange((model()['m'] as string).length, (model()['m'] as string).length);
    a.value = `${model()['m']} con PIN `;
    a.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    chips(fixture)[1].click();
    fixture.detectChanges();
    expect(model()['m']).toBe('{ref} con PIN {pin}');
  });
});
