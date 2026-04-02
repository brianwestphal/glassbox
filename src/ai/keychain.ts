import { spawnSync } from 'child_process';

import type { AIPlatform } from './models.js';

// PowerShell script that uses P/Invoke to read from Windows Credential Manager.
// cmdkey can store/delete but cannot retrieve passwords, so we use CredRead directly.
export const WIN_CRED_READ_PS = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CredHelper {
    [DllImport("advapi32", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CredRead(string t, int type, int f, out IntPtr p);
    [DllImport("advapi32")]
    static extern void CredFree(IntPtr p);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CRED {
        public int Flags; public int Type; public string TargetName; public string Comment;
        public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
        public int Persist; public int AttributeCount; public IntPtr Attributes;
        public string TargetAlias; public string UserName;
    }
    public static string Read(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr)) return "";
        CRED c = (CRED)Marshal.PtrToStructure(ptr, typeof(CRED));
        string r = Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
        CredFree(ptr);
        return r;
    }
}
'@
`;

export function winCredTarget(platform: AIPlatform): string {
  return `glassbox-${platform}-api-key`;
}

export function getKeyFromKeychain(platform: AIPlatform): string | null {
  const os = process.platform;
  const account = `${platform}-api-key`;

  try {
    if (os === 'darwin') {
      const r = spawnSync('security', ['find-generic-password', '-s', 'glassbox', '-a', account, '-w'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const result = r.stdout.trim();
      return r.status === 0 && result !== '' ? result : null;
    }

    if (os === 'linux') {
      const r = spawnSync('secret-tool', ['lookup', 'service', 'glassbox', 'account', account], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      const result = r.stdout.trim();
      return r.status === 0 && result !== '' ? result : null;
    }

    if (os === 'win32') {
      const target = winCredTarget(platform);
      const script = WIN_CRED_READ_PS + `Write-Output ([CredHelper]::Read('${target}'))`;
      const r = spawnSync('powershell', ['-NoProfile', '-Command', '-'], { input: script, encoding: 'utf-8' });
      const result = r.stdout.trim();
      return r.status === 0 && result !== '' ? result : null;
    }
  } catch {
    return null;
  }

  return null;
}

export function saveKeyToKeychain(platform: AIPlatform, key: string): void {
  const os = process.platform;
  const account = `${platform}-api-key`;

  if (os === 'darwin') {
    spawnSync('security', ['delete-generic-password', '-s', 'glassbox', '-a', account], { stdio: 'pipe' });
    spawnSync('security', ['add-generic-password', '-s', 'glassbox', '-a', account, '-w', key]);
    return;
  }

  if (os === 'linux') {
    // secret-tool reads the password from stdin
    spawnSync('secret-tool', ['store', '--label=Glassbox API Key', 'service', 'glassbox', 'account', account], { input: key, encoding: 'utf-8' });
    return;
  }

  if (os === 'win32') {
    const target = winCredTarget(platform);
    // Escape single quotes for PowerShell single-quoted string
    const escapedKey = key.replace(/'/g, "''");
    const script = `cmdkey /generic:'${target}' /user:'glassbox' /pass:'${escapedKey}'`;
    spawnSync('powershell', ['-NoProfile', '-Command', '-'], { input: script, encoding: 'utf-8' });
  }
}

export function isKeychainAvailable(): boolean {
  const os = process.platform;
  if (os === 'darwin' || os === 'win32') return true;
  if (os === 'linux') {
    return spawnSync('which', ['secret-tool'], { stdio: 'pipe' }).status === 0;
  }
  return false;
}

export function getKeychainLabel(): string {
  const os = process.platform;
  if (os === 'darwin') return 'Keychain';
  if (os === 'linux') return 'System Keyring';
  if (os === 'win32') return 'Credential Manager';
  return 'System Keychain';
}
