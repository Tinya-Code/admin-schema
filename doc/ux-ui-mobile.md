# Guía UX/UI Responsive y Mobile para Panel Administrativo

> **Audiencia:** agente de IA que diseña, revisa o implementa interfaces de un panel administrativo.
> **Propósito:** definir principios, reglas y criterios de decisión para que la experiencia en móvil y tablet sea tan sólida como en escritorio.
> **Formato:** conceptos y reglas. No incluye código. El agente debe traducir estas reglas a la tecnología del proyecto.

---

## 0. Cómo debe usar este documento el agente

1. Lee la sección 1 (principios) antes de tomar cualquier decisión de diseño.
2. Consulta la sección correspondiente al componente que vas a diseñar o revisar.
3. Antes de dar una tarea por terminada, recorre la sección 16 (checklist de validación).
4. Si una regla de este documento choca con una restricción del proyecto, prioriza la restricción del proyecto y documenta la excepción.
5. Cuando una regla diga **DEBE**, es obligatoria. **DEBERÍA** es recomendada. **PUEDE** es opcional.

---

## 1. Principios rectores

### 1.1 Contexto de uso

- Un panel administrativo en móvil **no es una versión reducida del escritorio**. Es un contexto distinto: sesiones cortas, interrupciones, una sola mano, conexión variable.
- El administrador en móvil suele **consultar, aprobar, corregir y reaccionar**. En escritorio suele **analizar, configurar y producir en masa**.
- Diseña primero las tareas móviles críticas; deja las tareas pesadas para pantallas grandes, pero nunca las bloquees sin una alternativa razonable.

### 1.2 Los siete principios

1. **Mobile-first en contenido, no solo en layout:** decide qué es esencial antes de decidir cómo se acomoda.
2. **Prioridad de información:** lo urgente y accionable va arriba; lo histórico y de detalle, abajo o detrás de un toque.
3. **Una acción principal por pantalla:** el usuario debe saber siempre cuál es el siguiente paso más probable.
4. **Alcance del pulgar:** las acciones frecuentes deben estar en la zona inferior y central de la pantalla.
5. **Densidad adaptativa:** menos información simultánea en móvil, pero acceso rápido a la que falta.
6. **Retroalimentación inmediata:** toda acción visible produce una respuesta visible (estado, confirmación o error).
7. **Prevención antes que corrección:** en móvil los errores son más probables (dedos imprecisos); diseña para evitarlos y para deshacerlos.

---

## 2. Estrategia responsive

### 2.1 Enfoque

- Diseñar de **menor a mayor**: base móvil, luego ampliar.
- Los puntos de quiebre se definen por **el contenido que se rompe**, no por modelos de dispositivos.
- Usar un número reducido de rangos conceptuales:

| Rango                                  | Comportamiento esperado                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Móvil compacto** (teléfono vertical) | Una columna, navegación inferior o menú colapsado, tablas convertidas en tarjetas/listas                 |
| **Móvil amplio / teléfono horizontal** | Una columna ancha o dos columnas simples; evitar que el contenido se estire sin control                  |
| **Tablet**                             | Navegación lateral colapsable (solo íconos o expandible), dos columnas, tablas con columnas prioritarias |
| **Escritorio**                         | Navegación lateral fija, múltiples paneles, tablas completas, atajos de teclado                          |

### 2.2 Reglas

- **DEBE** funcionar en orientación vertical y horizontal sin pérdida de funciones.
- **DEBE** evitar el scroll horizontal de la página completa. Solo se permite dentro de componentes específicos (por ejemplo, una tabla densa) y con indicio visual claro.
- **DEBE** respetar las zonas seguras del dispositivo (muescas, barra de gestos, esquinas redondeadas).
- **DEBE** tolerar texto ampliado por el usuario (accesibilidad del sistema) sin romper el layout.
- **DEBERÍA** apoyarse en el contenido fluido y en unidades relativas, evitando anchos fijos.
- **DEBERÍA** considerar plegables y ventanas redimensionables como casos reales.

---

## 3. Arquitectura de navegación

### 3.1 Principio

La navegación de un panel administrativo suele tener muchas secciones. En móvil hay que **jerarquizar**, no solo esconder.

### 3.2 Patrones y cuándo usarlos

| Patrón                                   | Úsalo cuando                                                      | Evítalo cuando                                  |
| ---------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------- |
| **Barra inferior de pestañas**           | Hay de 3 a 5 destinos principales y frecuentes                    | Hay más de 5 destinos o destinos de uso raro    |
| **Menú lateral deslizable (cajón)**      | Hay muchas secciones, con subniveles                              | Es el único acceso a funciones críticas diarias |
| **Barra superior con título y acciones** | Siempre, para dar contexto y acciones de la pantalla              | Nunca se omite                                  |
| **Pestañas superiores o segmentadas**    | Se alternan vistas del mismo objeto (resumen, actividad, ajustes) | Hay más de 4 o 5 pestañas sin scroll            |
| **Búsqueda global**                      | El panel tiene mucho contenido navegable                          | No hay nada que buscar                          |

### 3.3 Reglas

- **DEBE** mostrar siempre al usuario dónde está (título de pantalla, elemento activo en la navegación).
- **DEBE** permitir volver atrás de forma predecible (gesto del sistema, botón visible).
- **DEBERÍA** combinar barra inferior (accesos principales) + cajón (accesos secundarios y configuración).
- **DEBERÍA** limitar la profundidad de navegación a 3 niveles; más allá, ofrecer migas de pan compactas o búsqueda.
- **DEBERÍA** conservar el estado al navegar (filtros, scroll, pestaña) cuando el usuario regresa.
- **NO DEBE** esconder acciones críticas dentro de menús de tres puntos si se usan a diario.
- **PUEDE** personalizar los accesos principales según el rol del usuario.

---

## 4. Jerarquía visual y densidad de información

- Una pantalla móvil debe poder escanearse en **3 a 5 segundos**: título, estado clave, acción principal.
- Usar **tres niveles** de jerarquía tipográfica como máximo en una vista: título, dato principal, dato secundario.
- Agrupar con **espacio y contenedores**, no con líneas decorativas excesivas.
- Aplicar **divulgación progresiva**: mostrar el resumen, revelar el detalle bajo demanda (expandir, abrir hoja inferior, pasar a pantalla de detalle).
- Priorizar por pregunta del usuario: _¿qué pasó? ¿qué requiere mi atención? ¿qué puedo hacer ahora?_
- **DEBE** mantener contraste suficiente para lectura en exteriores y con brillo bajo.
- **DEBERÍA** usar color como refuerzo, nunca como único portador de significado (acompañar con texto o ícono).
- **NO DEBE** replicar toda la densidad del escritorio en móvil.

---

## 5. Dashboard / pantalla de inicio

### 5.1 Objetivo en móvil

Responder en una mirada: **¿hay algo que requiera mi atención?**

### 5.2 Estructura recomendada (de arriba hacia abajo)

1. **Alertas y pendientes urgentes** (aprobaciones, errores, incidentes).
2. **Indicadores clave (KPIs):** 3 a 4 como máximo visibles sin desplazarse; el resto, en carrusel o sección expandible.
3. **Acciones rápidas** frecuentes.
4. **Actividad reciente** o lista de elementos que requieren seguimiento.
5. **Gráficos de tendencia**, simplificados.

### 5.3 Reglas

- **DEBE** mostrar cada KPI con: valor, etiqueta clara, variación y periodo.
- **DEBERÍA** permitir tocar un KPI para ver su detalle.
- **DEBERÍA** ofrecer selector de periodo accesible con una mano.
- **DEBERÍA** permitir actualizar con gesto de jalar hacia abajo y mostrar la hora de la última actualización.
- **NO DEBE** saturar de widgets; cada tarjeta debe justificar su lugar con una decisión que habilita.

---

## 6. Tablas y datos tabulares (el punto más crítico)

Las tablas anchas son el principal problema de un panel administrativo en móvil. Elige la estrategia según el tipo de dato.

### 6.1 Árbol de decisión

| Situación                                     | Estrategia                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Pocos campos (2–3) por registro               | Lista simple con fila de dos líneas (principal + secundario)                             |
| Muchos campos, el usuario necesita ver varios | **Tarjetas** con campos clave visibles y el resto en detalle                             |
| Comparación entre filas es esencial           | Tabla con **primera columna fija** y desplazamiento horizontal contenido                 |
| Datos numéricos densos / análisis             | Mostrar resumen en móvil y ofrecer vista completa en pantalla grande o exportación       |
| Registros con estado y acciones               | Lista con **indicador de estado visible** y acciones por deslizamiento o menú contextual |

### 6.2 Reglas

- **DEBE** decidir qué 2–4 campos son los **campos clave** de cada entidad y mostrarlos siempre.
- **DEBE** mantener el identificador o nombre del registro visible en todo momento.
- **DEBE** garantizar que cada fila o tarjeta completa sea un objetivo táctil.
- **DEBERÍA** ofrecer ordenamiento y filtrado mediante controles móviles (hoja inferior), no cabeceras diminutas.
- **DEBERÍA** usar **paginación o carga progresiva**; evitar listas infinitas sin forma de volver arriba.
- **DEBERÍA** mostrar el total de resultados y los filtros activos.
- **DEBERÍA** permitir **selección múltiple** con un modo explícito (mantener pulsado o botón “Seleccionar”) y una barra de acciones masivas visible.
- **PUEDE** permitir personalizar qué columnas ver.
- **NO DEBE** reducir el tamaño de letra para forzar columnas; es peor que reorganizar.
- **NO DEBE** ocultar información crítica solo porque no cabe; muévela a un nivel de detalle accesible.

---

## 7. Formularios

### 7.1 Principios

- Una columna siempre en móvil.
- Etiquetas **siempre visibles** (no solo marcador de posición que desaparece).
- Agrupar campos por tema con títulos de sección.
- Para formularios largos, dividir en **pasos** o secciones plegables, con indicador de progreso.

### 7.2 Reglas

- **DEBE** elegir el tipo de teclado según el dato (numérico, correo, teléfono, URL, búsqueda).
- **DEBE** activar el autocompletado y autocorrección apropiados (y desactivarlos en códigos, identificadores y nombres propios cuando estorban).
- **DEBE** mostrar errores **junto al campo**, en lenguaje claro, indicando cómo corregir.
- **DEBE** validar en el momento adecuado: al salir del campo o al enviar, no mientras el usuario aún escribe.
- **DEBE** conservar lo escrito si ocurre un error o se pierde la conexión.
- **DEBERÍA** usar controles nativos o adaptados al tacto para fechas, horas y selecciones.
- **DEBERÍA** reemplazar listas desplegables largas por **búsqueda con selección** o por pantalla/hoja de selección.
- **DEBERÍA** mantener el botón de enviar visible (fijo en la parte inferior) en formularios largos.
- **DEBERÍA** guardar borradores automáticamente cuando el formulario es extenso.
- **DEBERÍA** separar visualmente la acción principal (guardar) de la secundaria (cancelar) y de la destructiva.
- **NO DEBE** pedir datos que ya se conocen o pueden deducirse.

---

## 8. Acciones, botones y gestos

### 8.1 Jerarquía de acciones

- **Primaria:** una sola por pantalla, de mayor peso visual.
- **Secundaria:** peso medio.
- **Terciaria / texto:** acciones de bajo énfasis.
- **Destructiva:** diferenciada, nunca adyacente a la primaria sin separación.

### 8.2 Reglas

- **DEBE** ofrecer un objetivo táctil mínimo de **44×44 pt / 48×48 dp**, con separación suficiente entre objetivos vecinos (aprox. 8 dp).
- **DEBERÍA** ubicar la acción principal en la zona inferior, accesible con el pulgar (botón fijo inferior o botón de acción flotante).
- **DEBERÍA** usar el botón de acción flotante solo para **una** acción de creación dominante.
- **DEBERÍA** usar gestos (deslizar fila, jalar para actualizar, arrastrar) **solo como atajo**, nunca como única vía; siempre debe existir un control visible equivalente.
- **DEBERÍA** indicar la existencia de gestos con pistas visuales (asa, flecha, primera vez con guía).
- **NO DEBE** depender de **hover**, clic derecho o doble clic: no existen en táctil.
- **NO DEBE** colocar acciones destructivas en zonas de toque accidental (bordes, cerca del teclado).

---

## 9. Acciones destructivas, confirmaciones y reversibilidad

- Preferir **deshacer** (aviso temporal con opción de revertir) sobre confirmaciones constantes para acciones comunes y de bajo riesgo.
- Reservar **diálogos de confirmación** para acciones irreversibles o de alto impacto (eliminar, revocar acceso, acciones masivas, cambios que afectan a terceros).
- La confirmación **DEBE** nombrar la acción y el objeto concreto (“Eliminar la factura #…”, no “¿Estás seguro?”).
- Para riesgo muy alto, **DEBERÍA** exigir una confirmación reforzada (escribir una palabra, mantener pulsado, reautenticar).
- Los botones del diálogo **DEBEN** usar verbos específicos, no “Sí/No”.
- **DEBERÍA** registrar las acciones sensibles en un historial auditable visible para el administrador.

---

## 10. Componentes de superposición (modales, hojas, menús)

| Componente                            | Uso en móvil                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Hoja inferior (bottom sheet)**      | Filtros, opciones, acciones contextuales, selecciones; reemplaza a la mayoría de los modales y menús desplegables |
| **Pantalla completa**                 | Tareas con varios campos, edición compleja, flujos con teclado                                                    |
| **Diálogo central**                   | Solo confirmaciones breves y mensajes críticos                                                                    |
| **Menú contextual**                   | Acciones secundarias de un elemento; preferir hoja inferior si hay más de 4–5 opciones                            |
| **Aviso temporal (toast / snackbar)** | Confirmaciones no críticas, con opción de deshacer                                                                |

### Reglas

- **DEBE** permitir cerrar de forma obvia (botón visible, gesto, toque fuera cuando sea seguro).
- **DEBE** evitar apilar superposiciones unas sobre otras.
- **DEBERÍA** conservar el contexto visible detrás cuando aporte orientación.
- **NO DEBE** usar ventanas emergentes pequeñas con contenido denso.
- **NO DEBE** tapar la acción que el aviso temporal intenta confirmar.

---

## 11. Estados de la interfaz

Todo componente de datos **DEBE** definir y diseñar cada uno de estos estados:

1. **Cargando:** preferir marcadores de posición con la forma del contenido (esqueletos) sobre indicadores giratorios genéricos.
2. **Vacío:** explicar por qué está vacío y qué hacer (con acción sugerida).
3. **Sin resultados (filtros):** indicar los filtros activos y ofrecer limpiarlos.
4. **Error:** decir qué ocurrió, si es culpa del sistema o del usuario, y cómo reintentar.
5. **Sin conexión:** indicar claramente que no hay red y qué sigue disponible.
6. **Parcial:** si parte de los datos falló, mostrar lo disponible y marcar lo faltante.
7. **Éxito:** confirmación proporcional a la importancia de la acción.
8. **Deshabilitado:** explicar por qué no está disponible (permiso, requisito pendiente).

### Reglas

- **DEBERÍA** actualizar de forma optimista cuando el riesgo es bajo, revirtiendo con aviso si falla.
- **DEBERÍA** mostrar el progreso en operaciones largas, con posibilidad de salir y volver sin perder el avance.
- **NO DEBE** dejar al usuario sin saber si una acción se ejecutó.

---

## 12. Rendimiento percibido y conectividad

- Asumir **redes lentas o inestables** como escenario normal.
- Priorizar el contenido visible primero (carga prioritaria de lo que está en pantalla).
- **DEBERÍA** cargar datos de forma progresiva y diferir gráficos y secciones pesadas.
- **DEBERÍA** conservar datos recientes para mostrarlos mientras se actualizan.
- **DEBERÍA** evitar saltos de layout mientras carga (reservar espacio).
- **DEBERÍA** limitar animaciones a las que aportan comprensión; mantenerlas breves y suaves.
- **DEBERÍA** ahorrar datos: imágenes proporcionales al tamaño de pantalla y gráficos simplificados en móvil.
- **PUEDE** ofrecer modo sin conexión de lectura para consultas críticas.

---

## 13. Gráficos y visualización de datos

- En móvil, **menos series, menos etiquetas, más claridad**.
- Elegir el tipo de gráfico por la pregunta: tendencia (línea), comparación (barras), composición (barras apiladas o anillo con pocos segmentos), distribución (histograma simple).
- **DEBE** permitir consultar el valor exacto tocando un punto o barra.
- **DEBE** evitar leyendas densas; etiquetar directamente cuando sea posible.
- **DEBERÍA** ofrecer orientación horizontal o pantalla completa para gráficos complejos.
- **DEBERÍA** acompañar cada gráfico con su cifra resumen en texto.
- **DEBERÍA** usar paletas con buen contraste y distinguibles para daltonismo (variar forma, patrón o etiqueta además del color).
- **NO DEBE** depender del hover para mostrar información.
- **NO DEBE** usar gráficos tridimensionales ni decorativos.

---

## 14. Accesibilidad (obligatoria)

- **DEBE** cumplir con contraste mínimo recomendado (texto normal ≥ 4.5:1, texto grande y componentes ≥ 3:1).
- **DEBE** ser operable con lector de pantalla: orden lógico, nombres accesibles en controles, estados anunciados.
- **DEBE** soportar tamaño de texto ampliado y zoom sin pérdida de funciones.
- **DEBE** tener foco visible y orden de foco coherente (también con teclado externo y tecnologías de apoyo).
- **DEBE** ofrecer alternativas a gestos complejos.
- **DEBE** respetar la preferencia del sistema de **reducir movimiento**.
- **DEBERÍA** soportar modo oscuro y modo claro, respetando la preferencia del sistema.
- **DEBERÍA** usar lenguaje claro, sin jerga innecesaria.
- **DEBERÍA** evitar límites de tiempo; si existen, avisar y permitir extender.
- **NO DEBE** transmitir información solo con color, sonido o vibración.

---

## 15. Sistema de diseño y consistencia

- Definir **tokens de diseño** conceptuales: color, tipografía, espaciado, radios, elevación, movimiento. Todo componente los consume; no se improvisan valores sueltos.
- Usar una **escala de espaciado** coherente (por ejemplo, múltiplos de una unidad base) y márgenes laterales uniformes en móvil.
- Definir una **escala tipográfica** corta con tamaños mínimos legibles en móvil (cuerpo cómodo, jamás texto principal diminuto).
- Mantener **un solo lenguaje** de íconos, con etiquetas de texto cuando el significado no sea universal.
- Documentar para cada componente: propósito, variantes, estados, comportamiento responsive, reglas de accesibilidad.
- **DEBERÍA** definir colores semánticos consistentes (éxito, advertencia, error, información, neutro) y usarlos con el mismo significado en todo el panel.
- **DEBERÍA** reutilizar componentes antes de crear nuevos.
- **NO DEBE** introducir un patrón nuevo si uno existente resuelve el caso.

---

## 16. Seguridad y roles en la experiencia

- La interfaz **DEBE** reflejar los permisos: ocultar o deshabilitar con explicación lo que el rol no puede hacer.
- Los datos sensibles **DEBERÍAN** enmascararse por defecto en móvil (espacios públicos) con opción de revelar.
- **DEBERÍA** ofrecer cierre de sesión por inactividad con aviso previo y sin pérdida de trabajo.
- **DEBERÍA** facilitar la autenticación en móvil (biométrica, gestor de contraseñas) y reautenticación para acciones sensibles.
- **DEBERÍA** mostrar sesiones activas y alertas de acceso desde nuevos dispositivos.
- **NO DEBE** exponer información sensible en notificaciones visibles en pantalla bloqueada.

---

## 17. Notificaciones y comunicación

- Las notificaciones **DEBEN** ser accionables y específicas (qué pasó, a qué elemento afecta, qué hacer).
- **DEBERÍA** agruparlas y permitir configurar tipos, canales y horarios.
- **DEBERÍA** llevar al usuario directamente al elemento relacionado, no a la pantalla de inicio.
- **DEBERÍA** distinguir urgentes de informativas.
- **NO DEBE** saturar; una notificación sin acción posible es ruido.

---

## 18. Microcopy y tono

- Frases cortas, verbos concretos, sin tecnicismos innecesarios.
- Etiquetas de botón: verbo + objeto (“Aprobar solicitud”, “Exportar informe”).
- Mensajes de error: qué pasó + por qué + qué hacer.
- Mensajes vacíos: invitar a la acción siguiente.
- Consistencia terminológica: un concepto, un nombre en todo el panel.
- En móvil, **recortar sin perder significado**: priorizar la palabra clave al inicio.

---

## 19. Anti-patrones (el agente debe evitarlos)

1. Encoger la interfaz de escritorio y llamarlo “responsive”.
2. Tablas anchas con scroll horizontal sin pistas ni columna fija.
3. Objetivos táctiles diminutos o pegados entre sí.
4. Dependencia de hover o clic derecho.
5. Menús de hamburguesa que esconden la navegación principal diaria.
6. Modales sobre modales.
7. Formularios largos en una sola pantalla sin pasos ni guardado.
8. Confirmaciones genéricas (“¿Estás seguro?”) en todas las acciones.
9. Acciones destructivas junto a la primaria sin separación.
10. Estados vacíos, de carga y de error sin diseñar.
11. Texto principal por debajo del tamaño legible.
12. Color como única señal de estado.
13. Gráficos saturados con leyendas microscópicas.
14. Listas infinitas sin forma de volver arriba o saber cuánto falta.
15. Perder lo escrito al fallar la conexión.
16. Animaciones decorativas que retrasan tareas.
17. Gestos ocultos sin alternativa visible.
18. Duplicar funciones con nombres distintos entre móvil y escritorio.

---

## 20. Checklist de validación final

El agente **DEBE** confirmar cada punto antes de entregar:

### Estructura y navegación

- [ ] Se identifica con claridad la pantalla actual y cómo volver.
- [ ] Los accesos principales están al alcance del pulgar.
- [ ] La profundidad de navegación es razonable y el estado se conserva.

### Contenido y jerarquía

- [ ] Lo urgente y accionable está arriba.
- [ ] Hay una sola acción primaria clara por pantalla.
- [ ] El detalle se revela de forma progresiva.

### Datos

- [ ] Las tablas tienen una estrategia móvil definida (lista, tarjeta o columna fija).
- [ ] Los campos clave de cada entidad están decididos y siempre visibles.
- [ ] Filtros, orden y selección múltiple funcionan con controles táctiles.

### Formularios y acciones

- [ ] Una columna, etiquetas visibles, teclado adecuado, errores junto al campo.
- [ ] Objetivos táctiles ≥ 44×44 pt / 48×48 dp con separación suficiente.
- [ ] Ningún flujo depende de hover ni de gestos sin alternativa.
- [ ] Acciones destructivas diferenciadas, con confirmación específica o deshacer.

### Estados y rendimiento

- [ ] Cargando, vacío, sin resultados, error, sin conexión y éxito están diseñados.
- [ ] No hay saltos de layout; el contenido prioritario carga primero.
- [ ] Lo escrito no se pierde ante fallos.

### Accesibilidad y consistencia

- [ ] Contraste, foco, texto ampliado, lector de pantalla y reducción de movimiento cumplidos.
- [ ] Se usan tokens y componentes existentes; no hay valores sueltos.
- [ ] Probado en vertical, horizontal, tablet y escritorio.
- [ ] Probado con una mano, red lenta y teclado en pantalla abierto.

---

## 21. Orden de prioridad cuando haya conflicto

1. Seguridad y prevención de pérdida de datos.
2. Accesibilidad.
3. Claridad de la tarea principal.
4. Consistencia con el sistema de diseño.
5. Rendimiento percibido.
6. Estética y refinamiento visual.

---

## 22. Instrucción final al agente

Ante cualquier duda de diseño, hazte estas cinco preguntas en orden:

1. ¿Qué intenta lograr el administrador en este momento, probablemente con una mano y poco tiempo?
2. ¿Cuál es la información mínima que necesita para decidir?
3. ¿Cuál es la acción siguiente más probable y está al alcance del pulgar?
4. ¿Qué pasa si se equivoca? ¿Puede deshacerlo?
5. ¿Funciona si la red es mala y el usuario usa lector de pantalla o texto grande?

Si alguna respuesta es “no” o “no sé”, rediseña antes de entregar.
