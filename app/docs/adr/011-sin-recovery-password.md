# ADR-011: Sin recovery de password

**Estado**: Accepted
**Fecha**: 2026-06-14

## Contexto

Los usuarios esperan poder hacer "olvidé mi contraseña" → mail con link → resetear. Pero
nuestro modelo de custodia híbrida ([ADR-002](002-custodia-hibrida-clave.md)) deriva la key
de cifrado de la clave privada **directamente de la password del usuario** (PBKDF2). El
server no puede descifrar la privada sin la password — solo guarda el ciphertext.

Si reseteamos la password, no podemos volver a cifrar la privada con la nueva, porque no
podemos descifrarla. La única forma de "resetear" sería borrar la cuenta y crear una nueva
identidad — pero eso significa **perder todas las entradas** que el usuario poseía, porque
están registradas on-chain a nombre de su pubkey vieja.

## Decisión

**No ofrecemos recovery de password.** Si el usuario olvida la password, pierde la cuenta
de forma definitiva. Esto se comunica explícitamente al registrarse.

## Consecuencias

### Positivas
- Mantiene la promesa criptográfica: el server nunca puede acceder a la privada.
- Diseño consistente: el sistema realmente significa lo que dice.

### Negativas
- UX inusual para usuarios acostumbrados a auth tradicional.
- Pérdida real de cuentas si los usuarios no son cuidadosos.

### Abiertas
- En el futuro podríamos ofrecer un **mnemonic backup opcional** al registro: durante la
  creación de la cuenta, mostrar una frase de 12 palabras que el usuario puede guardar como
  respaldo. Si pierde la password, puede usar el mnemonic para restaurar la clave privada,
  y entonces re-cifrarla con una password nueva.
- Si en algún punto el TP necesita recovery más amigable, se puede agregar un esquema
  Shamir Secret Sharing (clave dividida entre n trustees), pero es overkill por ahora.

## Alternativas consideradas

### Server guarda la privada cifrada con una key del server
Soluciona recovery pero rompe [ADR-002](002-custodia-hibrida-clave.md): si el server puede
descifrar, puede firmar.

### Recovery con email + nueva pubkey
Se pierde la propiedad on-chain (las entradas no se transfieren automáticamente a la pubkey
nueva). No es recovery, es "abandonar e empezar de cero" con otra cara.
