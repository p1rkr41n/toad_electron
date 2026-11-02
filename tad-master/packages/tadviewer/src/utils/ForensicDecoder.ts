/**
 * ForensicDecoder.ts
 * DFIR In-App Forensic Decoders & Defanger
 * Toad v1.3.1 - Forensic Deep-Dive
 */

export interface DecodeResult {
  success: boolean;
  type: "b64_utf16le" | "b64_utf8" | "url" | "defang";
  original: string;
  result: string;
  label: string;
}

export interface ForensicCapabilities {
  canDecodeUtf16LE: boolean;
  canDecodeUtf8: boolean;
  canDecodeUrl: boolean;
  canDefang: boolean;
  detectedBase64Token?: string;
}

/**
 * Check if a string contains mostly printable ASCII characters.
 */
function isMostlyPrintable(str: string): boolean {
  if (!str || str.length === 0) return false;
  let printable = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // tab, LF, CR, or standard printable ASCII 32-126
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) {
      printable++;
    }
  }
  return printable / str.length >= 0.85;
}

/**
 * Extract possible Base64 tokens from a string.
 * Minimum token length: 8 characters, valid Base64 alphabet with padding.
 */
function findBase64Tokens(text: string): string[] {
  // Matches base64 sequence of at least 8 characters
  const b64Regex = /[A-Za-z0-9+/]{8,}={0,2}/g;
  const matches = text.match(b64Regex);
  return matches || [];
}

/**
 * Decode Base64 string as UTF-16LE (standard for PowerShell -enc / -EncodedCommand)
 */
export function decodeBase64Utf16LE(rawB64: string): DecodeResult {
  const cleanB64 = rawB64.trim().replace(/\s+/g, "");
  try {
    let bytes: Uint8Array;
    if (typeof Buffer !== "undefined") {
      bytes = Buffer.from(cleanB64, "base64");
    } else {
      const binaryStr = atob(cleanB64);
      bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
    }

    if (bytes.length < 2) {
      return {
        success: false,
        type: "b64_utf16le",
        original: rawB64,
        result: "",
        label: "PowerShell UTF-16LE",
      };
    }

    let decoded = "";
    if (typeof TextDecoder !== "undefined") {
      const decoder = new TextDecoder("utf-16le");
      decoded = decoder.decode(bytes);
    } else {
      // Fallback manual UTF-16LE decoding
      for (let i = 0; i < bytes.length - 1; i += 2) {
        const code = bytes[i] | (bytes[i + 1] << 8);
        decoded += String.fromCharCode(code);
      }
    }

    const printable = isMostlyPrintable(decoded);
    return {
      success: printable && decoded.trim().length > 0,
      type: "b64_utf16le",
      original: rawB64,
      result: decoded,
      label: "PowerShell UTF-16LE",
    };
  } catch (err: any) {
    return {
      success: false,
      type: "b64_utf16le",
      original: rawB64,
      result: "",
      label: "PowerShell UTF-16LE",
    };
  }
}

/**
 * Decode Base64 string as standard UTF-8 / ASCII
 */
export function decodeBase64Utf8(rawB64: string): DecodeResult {
  const cleanB64 = rawB64.trim().replace(/\s+/g, "");
  try {
    let bytes: Uint8Array;
    if (typeof Buffer !== "undefined") {
      bytes = Buffer.from(cleanB64, "base64");
    } else {
      const binaryStr = atob(cleanB64);
      bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
    }

    if (bytes.length === 0) {
      return {
        success: false,
        type: "b64_utf8",
        original: rawB64,
        result: "",
        label: "Base64 (UTF-8)",
      };
    }

    let decoded = "";
    if (typeof TextDecoder !== "undefined") {
      const decoder = new TextDecoder("utf-8");
      decoded = decoder.decode(bytes);
    } else {
      decoded = String.fromCharCode.apply(null, Array.from(bytes));
    }

    const printable = isMostlyPrintable(decoded);
    return {
      success: printable && decoded.trim().length > 0,
      type: "b64_utf8",
      original: rawB64,
      result: decoded,
      label: "Base64 (UTF-8)",
    };
  } catch (err: any) {
    return {
      success: false,
      type: "b64_utf8",
      original: rawB64,
      result: "",
      label: "Base64 (UTF-8)",
    };
  }
}

/**
 * Decode URL-encoded text (e.g., %20, %2e%2e%2f, etc.)
 */
export function decodeUrl(rawText: string): DecodeResult {
  try {
    const decoded = decodeURIComponent(rawText);
    const hasChanged = decoded !== rawText;
    return {
      success: hasChanged,
      type: "url",
      original: rawText,
      result: decoded,
      label: "URL Decoded",
    };
  } catch (err: any) {
    // If standard decodeURIComponent fails on malformed percent encoding, try relaxed replace
    try {
      const relaxed = rawText.replace(/%([0-9a-fA-F]{2})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      );
      return {
        success: relaxed !== rawText,
        type: "url",
        original: rawText,
        result: relaxed,
        label: "URL Decoded",
      };
    } catch {
      return {
        success: false,
        type: "url",
        original: rawText,
        result: rawText,
        label: "URL Decoded",
      };
    }
  }
}

/**
 * Defang URLs, domains, and IP addresses to prevent accidental clicks
 * Examples:
 *   http://malicious.com -> hxxp://malicious[.]com
 *   https://1.2.3.4/payload -> hxxps://1[.]2[.]3[.]4/payload
 *   192.168.1.100 -> 192[.]168[.]1[.]100
 */
export function defangIoC(text: string): DecodeResult {
  let defanged = text;

  // 1. Schemes: http:// -> hxxp://, https:// -> hxxps://, ftp:// -> fxp://
  defanged = defanged.replace(/\bhttps:\/\//gi, "hxxps://");
  defanged = defanged.replace(/\bhttp:\/\//gi, "hxxp://");
  defanged = defanged.replace(/\bftp:\/\//gi, "fxp://");
  defanged = defanged.replace(/\bftps:\/\//gi, "fxps://");

  // 2. IPv4 addresses: 1.2.3.4 -> 1[.]2[.]3[.]4
  const ipv4Regex = /\b((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\.((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\.((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\.((?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))\b/g;
  defanged = defanged.replace(ipv4Regex, "$1[.]$2[.]$3[.]$4");

  // 3. Common domain TLDs: .com, .net, .org, .io, .xyz, .top, .ru, .cn, etc.
  // Replace unbracketed dot before recognized TLD
  const domainRegex = /([a-zA-Z0-9_-]+)\.(com|net|org|io|xyz|top|ru|cn|info|biz|cc|pw|live|online|site|gov|edu|mil)(?=[^\w]|$)/gi;
  defanged = defanged.replace(domainRegex, "$1[.]$2");

  const hasChanged = defanged !== text;
  return {
    success: hasChanged,
    type: "defang",
    original: text,
    result: defanged,
    label: "Defanged IoC",
  };
}

/**
 * Inspect a text string to determine what forensic decode/defang actions are viable.
 */
export function detectForensicCapabilities(text: any): ForensicCapabilities {
  if (text === null || text === undefined || typeof text !== "string") {
    return {
      canDecodeUtf16LE: false,
      canDecodeUtf8: false,
      canDecodeUrl: false,
      canDefang: false,
    };
  }

  const str = text.trim();
  if (str.length < 4) {
    return {
      canDecodeUtf16LE: false,
      canDecodeUtf8: false,
      canDecodeUrl: false,
      canDefang: false,
    };
  }

  // 1. Check for URL encoding (%20, %2e, etc.)
  const canDecodeUrl = /%[0-9a-fA-F]{2}/.test(str);

  // 2. Check for Defangable IoC (http://, https://, or IPv4 pattern)
  const canDefang =
    /https?:\/\/|ftp:\/\/|\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b|\.[a-zA-Z]{2,}(?=[/\s?]|$)/i.test(
      str
    );

  // 3. Check for Base64 tokens
  const tokens = findBase64Tokens(str);
  let canDecodeUtf16LE = false;
  let canDecodeUtf8 = false;
  let targetToken: string | undefined = undefined;

  for (const token of tokens) {
    // Try UTF-16LE first
    const res16 = decodeBase64Utf16LE(token);
    if (res16.success) {
      canDecodeUtf16LE = true;
      targetToken = token;
      break;
    }
    // Try UTF-8
    const res8 = decodeBase64Utf8(token);
    if (res8.success) {
      canDecodeUtf8 = true;
      targetToken = token;
      break;
    }
  }

  // If a full string is base64
  if (!targetToken && tokens.length > 0) {
    targetToken = tokens[0];
  }

  return {
    canDecodeUtf16LE,
    canDecodeUtf8,
    canDecodeUrl,
    canDefang,
    detectedBase64Token: targetToken,
  };
}
