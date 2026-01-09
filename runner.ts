import path from "path";
import { authenticateOAuth } from "./index.ts";

/**
 * Simple OAuth authentication example  
 * Pass credentials file path → Get token back
 */
async function main() {
    try {
        console.log('🔐 Starting OAuth authentication...\n');        // Universal authentication - works with any OAuth provider
        // Auto-detects Google's "installed" structure
        const token = await authenticateOAuth(path.join(import.meta.dirname, 'credentials.json'), {
            scope: 'https://www.googleapis.com/auth/contacts.readonly',
            tokenFileName: 'google-contacts-token.json',
            includeOfflineAccess: true,
            credentialsKey: 'installed',
            maxTokenLifetimeHours: 720 // 30 days - user only needs to authenticate once a month
        });

        if (!token) {
            console.error('❌ Authentication failed. Please check your credentials file.');
            process.exit(1);
        }        console.log('🎉 Authentication successful!');
        console.log('📋 Token info:');
        console.log(`   • Type: ${token.token_type}`);
        console.log(`   • Expires in: ${token.expires_in} seconds`);
        console.log(`   • Has refresh token: ${token.refresh_token ? 'Yes' : 'No'}`);
        console.log(`   • Scope: ${token.scope || 'Default'}`);
        console.log(`   • Custom max lifetime: 720 hours (30 days)`);
        
        // Important: OAuth access tokens typically expire quickly (e.g., 1 hour for Google)
        // But with a refresh token, the system can automatically get new access tokens
        // Your custom lifetime controls when the USER needs to manually re-authenticate
        if (token.refresh_token) {
            console.log(`   • Access token expires in: ${(token.expires_in / 3600).toFixed(1)} hours`);
            console.log(`   • Will auto-refresh until: 720 hours (30 days) from first auth`);
            console.log(`   • User will need to manually re-authenticate in: 720 hours`);
        } else {
            console.log(`   • User will need to re-authenticate in: ${Math.min(token.expires_in / 3600, 720).toFixed(1)} hours`);
        }

        // Example: Use the token to fetch some Google contacts
        console.log('\n📱 Testing API access...');
        const contacts = await testGoogleContactsAPI(token);
        
        if (contacts.length > 0) {
            console.log(`✅ Successfully retrieved ${contacts.length} contacts`);
            console.log('   Sample contact:');
            const sample = contacts[0];
            console.log(`   • Name: ${sample.names?.[0]?.givenName || 'Unknown'} ${sample.names?.[0]?.familyName || ''}`);
            console.log(`   • Email: ${sample.emailAddresses?.[0]?.value || 'No email'}`);
        } else {
            console.log('ℹ️  No contacts found or unable to access contacts');
        }

        console.log('\n✨ Done! Token has been saved for future use.');

    } catch (error: any) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

/**
 * Test the token by fetching a few Google contacts
 */
async function testGoogleContactsAPI(token: any): Promise<any[]> {
    try {
        const response = await fetch(
            'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=3',
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token.access_token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.ok) {
            console.log(`   API response: ${response.status} ${response.statusText}`);
            return [];
        }

        const data = await response.json();
        return data.connections || [];
    } catch (error) {
        console.log('   Unable to test API access:', error);
        return [];
    }
}

// Run the authentication
console.log
await main();
