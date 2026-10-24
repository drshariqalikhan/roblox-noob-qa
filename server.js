/**
 * supabase.js - Device Auth, DB Manager & Real-Time Connection Diagnostic Engine
 */

window.DB_LOGS = [];

function logDB(level, message, data = null) {
  const entry = {
    time: new Date().toLocaleTimeString(),
    level, // 'INFO', 'SUCCESS', 'WARN', 'ERROR'
    message,
    data
  };
  window.DB_LOGS.push(entry);
  console.log(`[DB ${level}] ${message}`, data || '');

  // Dispatch event so the UI log window updates in real time
  if (typeof window.onNewDBLog === 'function') {
    window.onNewDBLog(entry);
  }
}

// 1. Load Credentials from window.ENV (injected by /config.js)
const SUPABASE_URL = (window.ENV && window.ENV.SUPABASE_URL) ? window.ENV.SUPABASE_URL.trim() : "";
const SUPABASE_ANON_KEY = (window.ENV && window.ENV.SUPABASE_ANON_KEY) ? window.ENV.SUPABASE_ANON_KEY.trim() : "";

let supabase = null;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  logDB('WARN', 'Supabase credentials missing in window.ENV. Check .env file and /config.js route.');
} else {
  try {
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      logDB('INFO', `Supabase client initialized with URL: ${SUPABASE_URL}`);
    } else {
      logDB('ERROR', 'Supabase JS library (@supabase/supabase-js) is not loaded on the page.');
    }
  } catch (err) {
    logDB('ERROR', `Failed to initialize Supabase client: ${err.message}`, err);
  }
}

const DB = {
  getDeviceId() {
    let devId = localStorage.getItem('roblox_noob_device_uid');
    if (!devId) {
      devId = (window.crypto && crypto.randomUUID) 
        ? crypto.randomUUID() 
        : 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem('roblox_noob_device_uid', devId);
      logDB('INFO', `Generated new Device ID: ${devId}`);
    }
    return devId;
  },

  /**
   * Diagnostic Health Check: Runs on startup and tests every layer of your database setup
   */
  async testConnection() {
    logDB('INFO', '=== Starting Supabase Diagnostics ===');

    // Test 1: Check Environment Variables
    if (!SUPABASE_URL) {
      logDB('ERROR', 'SUPABASE_URL is empty! Ensure .env contains SUPABASE_URL and server.js is running.');
      return { ok: false, error: 'Missing SUPABASE_URL' };
    }
    if (!SUPABASE_ANON_KEY) {
      logDB('ERROR', 'SUPABASE_ANON_KEY is empty! Ensure .env contains SUPABASE_ANON_KEY.');
      return { ok: false, error: 'Missing SUPABASE_ANON_KEY' };
    }
    logDB('SUCCESS', `Keys found. URL: ${SUPABASE_URL}`);

    // Test 2: Check Client
    if (!supabase) {
      logDB('ERROR', 'Supabase client failed to initialize.');
      return { ok: false, error: 'Client not initialized' };
    }

    // Test 3: Ping database & query 'profiles' table
    try {
      logDB('INFO', 'Pinging table "profiles"...');
      const { data, error, status, statusText } = await supabase
        .from('profiles')
        .select('device_id')
        .limit(1);

      if (error) {
        // Detailed Troubleshooting Guidance
        if (error.code === '42P01') {
          logDB('ERROR', 'FATAL: Table "profiles" does NOT exist in your Supabase database!', error);
          logDB('WARN', 'Fix: Go to Supabase Dashboard -> SQL Editor and run the CREATE TABLE script.');
        } else if (error.code === '42501') {
          logDB('ERROR', 'RLS PERMISSION DENIED: Row Level Security is blocking the "anon" role!', error);
          logDB('WARN', 'Fix: In Supabase SQL Editor, run: CREATE POLICY "Allow read" ON public.profiles FOR SELECT TO anon USING (true);');
        } else {
          logDB('ERROR', `Query error [Code: ${error.code || 'N/A'} - HTTP ${status}]: ${error.message}`, error);
        }
        return { ok: false, error: error.message, details: error };
      }

      logDB('SUCCESS', `Connection verified! Table "profiles" is accessible (HTTP ${status}).`);

      // Test 4: Device specific lookup
      const deviceId = this.getDeviceId();
      logDB('INFO', `Querying profile for current device: ${deviceId}`);
      const { data: profile, error: pError } = await supabase
        .from('profiles')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle();

      if (pError) {
        logDB('ERROR', `Error fetching device profile: ${pError.message}`, pError);
        return { ok: false, error: pError.message };
      }

      if (profile) {
        logDB('SUCCESS', `Device recognized! Registered as: "${profile.username}" (${profile.coins} coins)`);
      } else {
        logDB('INFO', 'New device detected. No existing profile found yet (will prompt customizer).');
      }

      logDB('SUCCESS', '=== All Database Checks Passed ===');
      return { ok: true, profile };
    } catch (netErr) {
      logDB('ERROR', `Network / CORS error reaching Supabase: ${netErr.message}`, netErr);
      logDB('WARN', 'Troubleshoot: Verify your internet connection or check if an adblocker is blocking *.supabase.co.');
      return { ok: false, error: netErr.message };
    }
  },

  async getDeviceProfile() {
    if (!supabase) return null;
    const deviceId = this.getDeviceId();
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (error) {
      logDB('ERROR', `getDeviceProfile failed: ${error.message}`, error);
      return null;
    }
    return data;
  },

  async registerDeviceProfile(characterData) {
    if (!supabase) throw new Error("Supabase is not initialized.");
    const deviceId = this.getDeviceId();
    logDB('INFO', `Registering new device in DB: ${characterData.username}`);

    const { data, error } = await supabase
      .from('profiles')
      .insert([
        {
          device_id: deviceId,
          username: characterData.username,
          torso_color: characterData.torsoColor || '#0055bf',
          head_color: characterData.headColor || '#ffe800',
          hat: characterData.hat || 'hat_none',
          coins: 0,
          first_game_done: false
        }
      ])
      .select()
      .single();

    if (error) {
      logDB('ERROR', `Registration failed [${error.code}]: ${error.message}`, error);
      if (error.code === '42501') {
        logDB('WARN', 'Fix: Allow INSERT in RLS: CREATE POLICY "Allow insert" ON public.profiles FOR INSERT TO anon WITH CHECK (true);');
      }
      throw error;
    }

    logDB('SUCCESS', `Character "${characterData.username}" saved to database!`, data);
    return data;
  },

  async updateAttributes(updates) {
    if (!supabase) return null;
    const deviceId = this.getDeviceId();
    logDB('INFO', `Saving updates to DB for device ${deviceId}`, updates);

    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('device_id', deviceId)
      .select()
      .single();

    if (error) {
      logDB('ERROR', `updateAttributes failed [${error.code}]: ${error.message}`, error);
      if (error.code === '42501') {
        logDB('WARN', 'Fix: Allow UPDATE in RLS: CREATE POLICY "Allow update" ON public.profiles FOR UPDATE TO anon USING (true);');
      }
    } else {
      logDB('SUCCESS', 'Attributes synced with Supabase successfully.');
    }
    return data;
  }
};

window.DB = DB;