import { supabase } from './supabase.js';
import { saveCurrentSession, getCurrentSession as getSessionFromDB, clearCurrentSession, upsertStaffProfile, getStaffProfile } from './indexedDB.js';
import { setState } from '../state.js';

/**
 * Register a new business (Admin account + Restaurant profile).
 */
export async function registerBusiness(email, password, businessName, adminName) {
  try {
    // 1. Sign up the user (this automatically logs them in via Supabase)
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (authError) throw authError;
    if (!authData.user) throw new Error("Failed to create user.");

    // 2. Insert staff profile (Admin)
    const profile = {
      id: authData.user.id,
      email,
      display_name: adminName,
      role: 'admin',
      is_active: true
    };
    await supabase.from('staff_profiles').insert(profile);
    
    // Save to local IndexedDB
    await upsertStaffProfile(profile);

    // 3. Insert/update Restaurant Profile
    const { pushRestaurantProfile } = await import('./supabase.js');
    const { getRestaurantProfile, upsertRestaurant } = await import('./indexedDB.js');
    
    let rest = await getRestaurantProfile();
    if (!rest) {
      const { v4: uuidv4 } = await import('uuid');
      rest = { id: uuidv4() };
    }
    rest.business_name = businessName;
    rest.address = 'Not provided';
    rest.admin_user_id = authData.user.id; // tie it to admin
    
    await pushRestaurantProfile(rest);
    await upsertRestaurant(rest);

    // 4. Set state and cache session
    const sessionData = {
      ...authData.session,
      role: 'admin',
      display_name: adminName
    };
    await saveCurrentSession(sessionData);
    
    setState('currentUser', authData.session);
    setState('userRole', 'admin');
    setState('authState', 'authenticated');

    return { success: true };
  } catch (error) {
    console.error("[Auth] Registration failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a staff account (Admin only).
 * Handles the Supabase gotcha where signUp auto-logs in the new user, by restoring the admin session.
 */
export async function createStaffAccount(email, password, displayName, role) {
  try {
    const adminSession = await getSessionFromDB();
    if (!adminSession || adminSession.role !== 'admin') throw new Error("Only admins can create staff accounts.");

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });
    
    if (authError) throw authError;

    const profile = {
      id: authData.user.id,
      email,
      display_name: displayName,
      role,
      is_active: true
    };
    
    const { error: dbError } = await supabase.from('staff_profiles').insert(profile);
    if (dbError) throw dbError;
    
    await upsertStaffProfile(profile);

    // Restore Admin Session
    await supabase.auth.setSession({
      access_token: adminSession.access_token,
      refresh_token: adminSession.refresh_token
    });

    return { success: true, profile };
  } catch (error) {
    console.error("[Auth] Create staff failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Toggle staff active status.
 */
export async function toggleStaffStatus(staffId, isActive) {
  try {
    const { error } = await supabase.from('staff_profiles').update({ is_active: isActive }).eq('id', staffId);
    if (error) throw error;
    
    const profile = await getStaffProfile(staffId) || { id: staffId };
    profile.is_active = isActive;
    profile.updated_at = new Date().toISOString();
    await upsertStaffProfile(profile);
    return { success: true };
  } catch (err) {
    console.error("[Auth] Toggle staff failed:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Login a user.
 */
export async function loginUser(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.session) throw new Error("No session returned.");

    // Fetch role from staff_profiles
    const { data: profileData, error: profileError } = await supabase
      .from('staff_profiles')
      .select('role, display_name, is_active')
      .eq('id', data.user.id)
      .single();

    if (profileError) throw profileError;
    if (!profileData.is_active) {
      await supabase.auth.signOut();
      throw new Error("Your account has been deactivated. Please contact your admin.");
    }

    const sessionData = {
      ...data.session,
      role: profileData.role,
      display_name: profileData.display_name
    };

    await saveCurrentSession(sessionData);
    
    setState('currentUser', data.session);
    setState('userRole', profileData.role);
    setState('authState', 'authenticated');

    return { success: true, role: profileData.role };
  } catch (error) {
    console.error("[Auth] Login failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Logout the user.
 */
export async function logoutUser() {
  try {
    await supabase.auth.signOut();
    await clearCurrentSession();
    
    setState('currentUser', null);
    setState('userRole', null);
    setState('authState', 'unauthenticated');
    return { success: true };
  } catch (error) {
    console.error("[Auth] Logout failed:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if a session exists (useful on boot).
 */
export async function checkSession() {
  try {
    // Check IndexedDB first for offline-first behavior
    const localSession = await getSessionFromDB();
    if (localSession) {
      // Optimistically restore session
      setState('currentUser', localSession);
      setState('userRole', localSession.role);
      setState('authState', 'authenticated');
      
      // If online, refresh/validate with Supabase quietly
      if (navigator.onLine) {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) {
          // Token expired or invalid
          console.warn("[Auth] Session expired or invalid on cloud, logging out.");
          await logoutUser();
        } else {
          // Verify user is still active
          const { data: profile } = await supabase
            .from('staff_profiles')
            .select('is_active, role')
            .eq('id', data.session.user.id)
            .single();
            
          if (profile && !profile.is_active) {
            await logoutUser();
          } else if (profile) {
            // Update cached session
            await saveCurrentSession({
              ...data.session,
              role: profile.role,
              display_name: localSession.display_name
            });
            setState('userRole', profile.role);
          }
        }
      }
      return true;
    }
    
    // No local session
    setState('authState', 'unauthenticated');
    return false;
  } catch (error) {
    console.error("[Auth] Session check failed:", error);
    setState('authState', 'unauthenticated');
    return false;
  }
}
