// core/13-props — ÚNICO punto de acceso a PropertiesService.
//
// Nadie más en api/ toca el servicio de propiedades (baseapi §10.5).
//   - Lectura: una vez por ejecución, cacheada en memoria.
//   - Escritura: sólo vía setAll (invalida la caché).
//   - Error: si falta una requerida → Error «Falta configurar X» (500 en core/12-http),
//     sin revelar valores.
// Top-level: sólo declaraciones (cero referencias a otros archivos al cargar).

var propsCache_ = null; // caché en memoria por ejecución (null = sin cargar)

// Carga (una sola vez) todas las propiedades del script en memoria.
function propsLoad_() {
  if (propsCache_ === null) {
    propsCache_ = PropertiesService.getScriptProperties().getProperties();
  }
  return propsCache_;
}

var Props = {
  // Valor de la propiedad o null si no existe/vacía.
  get: function (name) {
    var raw = propsLoad_()[name];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return null;
    }
    return raw;
  },

  // ¿Existe y no está vacía?
  has: function (name) {
    return Props.get(name) !== null;
  },

  // Exigida por código: si falta, lanza Error claro que core/12-http
  // responde como 500 con el NOMBRE de la propiedad (nunca el valor).
  require: function (name) {
    var value = Props.get(name);
    if (value === null) {
      var err = new Error('Falta configurar la propiedad: ' + name);
      err.apiStatus = 500; // convención de core/12-http
      throw err;
    }
    return value;
  },

  // Única escritura (varios pares a la vez) + invalidación de caché.
  setAll: function (values) {
    // false = no borra las demás propiedades existentes.
    PropertiesService.getScriptProperties().setProperties(values, false);
    propsCache_ = null; // la próxima lectura recarga desde el servicio
  },

  // Fuerza la recarga (uso puntual tras escribir por fuera).
  clearCache: function () {
    propsCache_ = null;
  },

  // SHA-256 en hex de cualquier texto (uso general: token y versiones).
  hashText: function (text) {
    var bytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(text),
      Utilities.Charset.UTF_8,
    );
    return bytes
      .map(function (b) {
        return (b + 256).toString(16).slice(-2);
      })
      .join('');
  },

  // Hash del token admin (respalda ADMIN_TOKEN_HASH; lo usa core/11-auth).
  hashToken: function (token) {
    return Props.hashText(token);
  },

  // Token admin aleatorio (dos UUID = 244 bits de entropía).
  generateToken: function () {
    return Utilities.getUuid() + Utilities.getUuid();
  },
};
