# Panel Administrativo Dinámico: Guía UX/UI de Campos y Formularios

## Objetivo
Diseñar formularios que se adapten a **cualquier tipo de dato o campo**, sean cortos o muy extensos, manteniendo siempre la misma lógica visual y de uso. El usuario debe saber qué llenar, cómo hacerlo y qué falta, sin esfuerzo.

## Principios
1. **Consistencia**: el mismo tipo de campo se ve y se comporta igual en todo el panel.
2. **Claridad**: etiqueta visible, ayuda breve, errores específicos.
3. **Progresión**: mostrar primero lo esencial; lo avanzado, oculto pero accesible.
4. **Control**: el usuario nunca pierde lo que escribió.
5. **Feedback**: cada acción responde (guardando, guardado, error).

---

## 1. Tipos de campo y cómo presentarlos

### Texto
| Campo | Cómo presentarlo |
|---|---|
| Texto corto | Input de una línea, placeholder de ejemplo |
| Texto largo | Textarea que crece sola, contador de caracteres si hay límite |
| Texto enriquecido | Editor con barra mínima (negrita, lista, enlace) |
| Email / URL / Teléfono | Input con icono, formato y validación al salir del campo |
| Contraseña | Botón mostrar/ocultar, indicador de fortaleza |

### Números
| Campo | Cómo presentarlo |
|---|---|
| Número | Input alineado a la derecha, con unidad visible (kg, %, cm) |
| Moneda | Símbolo fijo + separador de miles automático |
| Rango / cantidad | Slider (rango visual) o stepper +/− (cantidades pequeñas) |

### Selección
| Campo | Cómo presentarlo |
|---|---|
| Sí / No | **Switch** con etiqueta clara del estado |
| 2–4 opciones | **Radio buttons** visibles (no esconder en dropdown) |
| 5–7 opciones | Dropdown simple |
| Más de 7 opciones | **Dropdown con búsqueda** |
| Selección múltiple | Dropdown con **chips** removibles; checkboxes si son pocas opciones |
| Relación con otra entidad | Dropdown con búsqueda, muestra nombre + dato secundario (ej. "Juan Pérez · DNI 123") |
| Opción no existe | Botón "+ Crear nuevo" dentro del dropdown |
| Dependientes (país → ciudad) | El hijo se desactiva hasta elegir el padre y se reinicia si el padre cambia |

**Reglas de dropdown**: opción "Limpiar", mensaje "Sin resultados", indicador de carga, navegación con teclado, valor seleccionado siempre visible.

### Fecha y hora
- Fecha: datepicker con opción de escribir manualmente.
- Rango de fechas: un solo selector con dos calendarios y atajos (hoy, últimos 7 días, este mes).
- Hora: selector simple con formato 24 h o AM/PM según el usuario.

### Archivos
- **Dropzone** (arrastrar o hacer clic) con tipos y tamaño permitidos escritos a la vista.
- Vista previa de imágenes, barra de progreso, botón para quitar o reemplazar.
- Múltiples archivos: lista con nombre, peso y acción de eliminar.

### Otros
- **Color**: selector con muestra y código.
- **Ubicación**: buscador de dirección + mapa opcional.
- **Lista repetible** (teléfonos, ítems, direcciones): filas con botón "+ Agregar" y "🗑 Quitar" por fila; permitir reordenar.
- **Etiquetas (tags)**: escribir y Enter para crear chip.
- **Solo lectura / calculado**: estilo atenuado, sin apariencia de editable, con candado opcional.

---

## 2. Anatomía de un campo
Orden fijo, siempre igual:
1. **Etiqueta** arriba (nunca solo placeholder).
2. **Control** (input, dropdown, etc.).
3. **Texto de ayuda** debajo, corto (opcional).
4. **Mensaje de error** debajo, en rojo, reemplaza la ayuda.

Reglas:
- Obligatorios marcados con `*`; si casi todos son obligatorios, marcar los **opcionales** con "(opcional)".
- Placeholder = ejemplo ("Ej. 987654321"), nunca instrucción.
- Estados visibles: normal, foco, error, éxito, deshabilitado, solo lectura.
- Errores en lenguaje humano: "Ingresa un correo válido", no "Formato inválido".

---

## 3. Layout del formulario
- **Móvil**: una columna.
- **Escritorio**: dos columnas para campos cortos; textos largos, editores y listas ocupan todo el ancho.
- Agrupar campos relacionados (ej. nombre + apellido en la misma fila).
- Espaciado generoso entre grupos; título claro por sección.
- Botones **Guardar** (primario) y **Cancelar** (secundario) alineados siempre en el mismo lugar.

---

## 4. Formularios extensos (clave)

Elegir la estrategia según la cantidad de campos:

| Cantidad | Estrategia |
|---|---|
| 1–8 campos | Una sola página, sin divisiones |
| 9–20 campos | **Secciones con título**, scroll continuo |
| 20–40 campos | **Secciones colapsables** (acordeón) o **pestañas**, con barra lateral de navegación interna |
| +40 campos o proceso largo | **Asistente por pasos (wizard)** |

### Técnicas obligatorias para formularios largos
1. **Dividir por secciones lógicas** (Datos generales, Contacto, Pagos, Adicional…), cada una con título y breve descripción.
2. **Navegación interna fija**: índice lateral o pestañas con el nombre de cada sección; la sección activa se resalta al hacer scroll.
3. **Indicador de progreso**: "Paso 2 de 5" o barra de avance; marcar secciones completas con ✓ y las que tienen errores con ⚠.
4. **Campos avanzados ocultos**: botón "Mostrar opciones avanzadas" para lo poco usado.
5. **Campos condicionales**: solo aparecen cuando aplican (ej. "Razón social" solo si es empresa), con transición suave.
6. **Autoguardado de borrador** cada cierto tiempo, con aviso discreto "Borrador guardado hace 1 min".
7. **Aviso al salir** si hay cambios sin guardar.
8. **Barra de acciones fija** (sticky) al pie con Guardar siempre visible.
9. **Validación por sección**: en wizard, validar antes de avanzar; en página larga, al salir de cada campo.
10. **Resumen de errores** al enviar: mensaje superior con enlaces que llevan directo a cada campo con error.
11. **Valores por defecto inteligentes** y autocompletado para reducir escritura.
12. **Permitir volver atrás** sin perder datos y editar cualquier paso desde un resumen final.
13. **Paso de revisión** al final del wizard: resumen de todo lo ingresado antes de confirmar.

### Wizard: buenas prácticas
- Máximo 5–7 pasos; 5–8 campos por paso.
- Nombres de paso descriptivos, no "Paso 1".
- Botones: **Atrás**, **Siguiente**, **Guardar y salir**.
- Permitir saltar entre pasos ya visitados.

---

## 5. Edición vs creación
- **Crear**: formulario limpio con valores por defecto.
- **Editar**: valores precargados, indicar qué cambió (punto o resaltado sutil), botón "Restablecer".
- **Edición rápida** de pocos campos: panel lateral (drawer) en lugar de pantalla nueva, para no perder contexto.
- **Ver detalle**: misma estructura que el formulario, en modo lectura.

---

## 6. Feedback y estados
- Al guardar: botón con spinner y deshabilitado para evitar doble envío.
- Éxito: notificación breve (toast) y volver a la lista o quedarse según el flujo.
- Error del servidor: mensaje claro, conservar todo lo escrito.
- Carga de opciones (dropdowns): skeleton o spinner dentro del campo.
- Eliminar: confirmación explícita con el nombre del registro.

---

## 7. UI visual (resumen)
- Una sola tipografía sans-serif, jerarquía clara (título de sección 18 px, etiqueta 14 px, ayuda 12 px).
- Un color primario para acciones; rojo solo para errores y eliminar; verde para éxito.
- Contraste mínimo AA; no depender solo del color para indicar errores (añadir icono y texto).
- Altura uniforme de controles (40 px recomendado), bordes suaves, foco claramente visible.
- Soporte de modo oscuro.
- Objetivos táctiles mínimo 44 px en móvil.

---

## 8. Accesibilidad
- Todo operable con teclado (Tab, Enter, Esc, flechas en dropdowns).
- Cada campo con etiqueta asociada.
- Errores anunciados y vinculados al campo.
- Orden de tabulación lógico, igual al orden visual.

---

## Checklist final
- [ ] Cada tipo de dato tiene un control apropiado y consistente.
- [ ] Más de 7 opciones usa dropdown con búsqueda.
- [ ] Todas las etiquetas visibles; placeholders solo como ejemplo.
- [ ] Errores claros, cerca del campo y con resumen al enviar.
- [ ] Formularios largos divididos en secciones, pestañas o pasos.
- [ ] Navegación interna y progreso visibles en formularios extensos.
- [ ] Campos avanzados y condicionales ocultos hasta ser necesarios.
- [ ] Borrador autoguardado y aviso de cambios sin guardar.
- [ ] Botón Guardar siempre visible.
- [ ] Funciona en móvil y con teclado.