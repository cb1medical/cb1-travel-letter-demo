/* =============================================================================
 * crypto.js - signature decryption (runs entirely in the patient's browser)
 * -----------------------------------------------------------------------------
 * The doctor's signature is shipped ENCRYPTED (see signature.enc.js). The access
 * PIN is the only thing that can decrypt it. Nothing here talks to a network.
 *
 * Scheme (must match tools/encrypt-signature.mjs):
 *   - Key:    PBKDF2(pin, salt, iterations, SHA-256) -> AES-GCM 256-bit key
 *   - Cipher: AES-GCM(iv), ciphertext includes the 16-byte auth tag at the end
 * A wrong PIN makes AES-GCM authentication fail, which we surface as
 * "incorrect PIN".
 * ========================================================================== */

const SignatureCrypto = (() => {
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function bytesToBase64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  async function deriveKey(pin, saltBytes, iterations) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(pin),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  /**
   * Decrypt the signature blob with the given PIN.
   * @returns {Promise<string>} a data: URL (e.g. "data:image/png;base64,...")
   * @throws if the PIN is wrong or the blob is malformed.
   */
  async function decryptSignature(pin, blob) {
    if (!blob || !blob.data) throw new Error("Missing signature blob");

    const salt = base64ToBytes(blob.kdf.salt);
    const iv = base64ToBytes(blob.cipher.iv);
    const ciphertext = base64ToBytes(blob.data);
    const iterations = blob.kdf.iterations;
    const mime = blob.mime || "image/png";

    const key = await deriveKey(pin, salt, iterations);

    // Throws (OperationError) if the PIN is wrong - GCM auth tag fails.
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );

    return `data:${mime};base64,${bytesToBase64(new Uint8Array(plainBuf))}`;
  }

  return { decryptSignature };
})();
