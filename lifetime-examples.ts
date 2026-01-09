import path from "path";
import { authenticateOAuth } from "./index.ts";

/**
 * Examples of different token lifetime configurations
 */

async function example1_shortLived() {
    console.log('\n🕐 Example 1: Short-lived tokens (1 hour)');
    console.log('   Use case: High-security applications, temporary access');
    
    const token = await authenticateOAuth(path.join(import.meta.dirname, 'credentials.json'), {
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        tokenFileName: 'short-lived-token.json',
        credentialsKey: 'installed',
        maxTokenLifetimeHours: 1 // 1 hour
    });
      if (token) {
        const serverLifetimeHours = token.expires_in / 3600;
        if (token.refresh_token) {
            console.log(`   ✅ Access token expires in ${serverLifetimeHours.toFixed(1)} hours, but will auto-refresh`);
            console.log(`   📝 User will need to re-authenticate in 1 hour (custom lifetime)`);
        } else {
            console.log(`   ✅ Token will expire in ${serverLifetimeHours.toFixed(1)} hours`);
            console.log(`   📝 User will need to re-authenticate in 1 hour`);
        }
    }
}

async function example2_daily() {
    console.log('\n📅 Example 2: Daily authentication (24 hours)');
    console.log('   Use case: Regular business applications, daily workflow');
    
    const token = await authenticateOAuth(path.join(import.meta.dirname, 'credentials.json'), {
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        tokenFileName: 'daily-token.json',
        credentialsKey: 'installed',
        maxTokenLifetimeHours: 24 // 1 day
    });
      if (token) {
        const serverLifetimeHours = token.expires_in / 3600;
        if (token.refresh_token) {
            console.log(`   ✅ Access token expires in ${serverLifetimeHours.toFixed(1)} hours, but will auto-refresh`);
            console.log(`   📝 User will need to re-authenticate in 24 hours (custom lifetime)`);
        } else {
            console.log(`   ✅ Token will expire in ${Math.min(serverLifetimeHours, 24).toFixed(1)} hours`);
            console.log(`   📝 User will need to re-authenticate once per day`);
        }
    }
}

async function example3_weekly() {
    console.log('\n📰 Example 3: Weekly authentication (168 hours)');
    console.log('   Use case: Weekly reports, less frequent access');
    
    const token = await authenticateOAuth(path.join(import.meta.dirname, 'credentials.json'), {
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        tokenFileName: 'weekly-token.json',
        credentialsKey: 'installed',
        maxTokenLifetimeHours: 168 // 7 days
    });
      if (token) {
        const serverLifetimeHours = token.expires_in / 3600;
        if (token.refresh_token) {
            console.log(`   ✅ Access token expires in ${serverLifetimeHours.toFixed(1)} hours, but will auto-refresh`);
            console.log(`   📝 User will need to re-authenticate in 168 hours (7 days)`);
        } else {
            console.log(`   ✅ Token will expire in ${Math.min(serverLifetimeHours, 168).toFixed(1)} hours`);
            console.log(`   📝 User will need to re-authenticate once per week`);
        }
    }
}

async function example4_monthly() {
    console.log('\n🗓️  Example 4: Monthly authentication (720 hours)');
    console.log('   Use case: Monthly reports, convenient for end users');
    
    const token = await authenticateOAuth(path.join(import.meta.dirname, 'credentials.json'), {
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        tokenFileName: 'monthly-token.json',
        credentialsKey: 'installed',
        maxTokenLifetimeHours: 720 // 30 days
    });
      if (token) {
        const serverLifetimeHours = token.expires_in / 3600;
        if (token.refresh_token) {
            console.log(`   ✅ Access token expires in ${serverLifetimeHours.toFixed(1)} hours, but will auto-refresh`);
            console.log(`   📝 User will need to re-authenticate in 720 hours (30 days)`);
        } else {
            console.log(`   ✅ Token will expire in ${Math.min(serverLifetimeHours, 720).toFixed(1)} hours`);
            console.log(`   📝 User will need to re-authenticate once per month`);
        }
    }
}

async function example5_noLimit() {
    console.log('\n♾️  Example 5: No custom limit (server default)');
    console.log('   Use case: Use OAuth server\'s default expiration time');
    
    const token = await authenticateOAuth(path.join(import.meta.dirname, 'credentials.json'), {
        scope: 'https://www.googleapis.com/auth/contacts.readonly',
        tokenFileName: 'server-default-token.json',
        credentialsKey: 'installed'
        // No maxTokenLifetimeHours specified - uses server default
    });
    
    if (token) {
        const serverLifetimeHours = token.expires_in / 3600;
        console.log(`   ✅ Token will expire in ${serverLifetimeHours.toFixed(1)} hours (server default)`);
        console.log(`   📝 User will need to re-authenticate based on OAuth server settings`);
    }
}

async function main() {
    console.log('🔐 Token Lifetime Examples');
    console.log('=========================');
    console.log('This shows how to control how often users need to re-authenticate');
    
    try {
        await example1_shortLived();
        await example2_daily();
        await example3_weekly();
        await example4_monthly();
        await example5_noLimit();
        
        console.log('\n✨ All examples completed!');        console.log('\n💡 Tips:');
        console.log('   • Shorter lifetimes = more secure, more user interruption');
        console.log('   • Longer lifetimes = more convenient, less secure');
        console.log('   • Choose based on your security requirements and user experience needs');
        console.log('   • Access tokens expire quickly (e.g., 1 hour), but refresh automatically');
        console.log('   • Your custom lifetime controls when users must manually re-authenticate');
        console.log('   • With refresh tokens, users won\'t be interrupted until your custom lifetime expires');
        
    } catch (error: any) {
        console.error('❌ Error running examples:', error.message);
    }
}

// Run examples if this file is executed directly
main();
