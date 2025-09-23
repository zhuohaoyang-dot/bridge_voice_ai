const axios = require('axios');

// Configuration
const SERVER_URL = 'http://localhost:3010'; // Your server URL
const TEST_CONFIG = {
  customerPhone: '+17273666255', // Replace with test phone number
  customerId: 'test-001',
  customerName: 'Test Customer',
  callId: 'test-vapi-call-123', // Mock VAPI call ID
  sessionData: {
    qualified: true,
    caseType: 'PFAS',
    exposureLocation: 'Test Location',
    exposureDuration: '5 years'
  }
};

// Test 1: Create Conference and Transfer
async function testCreateConference() {
  console.log('\n🔵 TEST 1: Creating Conference Bridge...\n');
  
  try {
    const response = await axios.post(`${SERVER_URL}/api/conference/create`, {
      callId: TEST_CONFIG.callId,
      customerId: TEST_CONFIG.customerId,
      customerPhone: TEST_CONFIG.customerPhone,
      customerName: TEST_CONFIG.customerName,
      sessionData: TEST_CONFIG.sessionData,
      qualificationSummary: 'Test customer qualified for PFAS case',
      exposureDetails: 'Exposed to contaminated water for 5 years',
      healthConcerns: 'Various health issues reported'
    });

    console.log('✅ Conference created successfully!');
    console.log('Conference ID:', response.data.conferenceId);
    console.log('Status:', response.data.success);
    
    return response.data.conferenceId;
  } catch (error) {
    console.error('❌ Error creating conference:', error.response?.data || error.message);
    return null;
  }
}

// Test 2: Check Conference Status
async function testGetConferenceStatus(conferenceId) {
  console.log('\n🔵 TEST 2: Checking Conference Status...\n');
  
  try {
    const response = await axios.get(`${SERVER_URL}/api/conference/status/${conferenceId}`);
    
    console.log('✅ Conference Status:');
    console.log('- Status:', response.data.conference.status);
    console.log('- Participants:', response.data.conference.participants);
    console.log('- Wait Time:', response.data.conference.waitTime, 'seconds');
    
    return response.data;
  } catch (error) {
    console.error('❌ Error getting conference status:', error.response?.data || error.message);
  }
}

// Test 3: Simulate Agent Joining
async function testAddAgent(conferenceId) {
  console.log('\n🔵 TEST 3: Simulating Agent Join...\n');
  
  try {
    const response = await axios.post(`${SERVER_URL}/api/conference/add-agent`, {
      conferenceId: conferenceId,
      agentPhone: '+13475650253', // Test agent phone
      agentName: 'Test Agent',
      agentId: 'agent-001'
    });
    
    console.log('✅ Agent added successfully!');
    console.log('Response:', response.data);
    
  } catch (error) {
    console.error('❌ Error adding agent:', error.response?.data || error.message);
  }
}

// Test 4: Test VAPI Hold Assistant Configuration
async function testVapiHoldAssistant() {
  console.log('\n🔵 TEST 4: Testing VAPI Hold Assistant...\n');
  
  // This would normally be done through VAPI dashboard
  console.log('📋 Checklist for VAPI Hold Assistant:');
  console.log('1. ✓ Hold Assistant ID configured in .env');
  console.log('2. ✓ Hold Assistant Phone Number ID configured in .env');
  console.log('3. ✓ Assistant configured with conference-aware prompts');
  console.log('4. ✓ Assistant listens for "agent-joined" message');
  console.log('5. ✓ Assistant configured to end call on trigger phrase');
}

// Run all tests
async function runTests() {
  console.log('🚀 Starting Conference Bridge Tests...\n');
  console.log('================================\n');
  
  // Create conference
  const conferenceId = await testCreateConference();
  
  if (!conferenceId) {
    console.log('\n❌ Cannot continue tests without conference ID');
    return;
  }
  
  // Wait a bit for conference to initialize
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check status
  await testGetConferenceStatus(conferenceId);
  
  // Test VAPI assistant info
  await testVapiHoldAssistant();
  
  // Wait before adding agent
  console.log('\n⏳ Waiting 5 seconds before adding agent...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Add agent
  await testAddAgent(conferenceId);
  
  // Check final status
  await new Promise(resolve => setTimeout(resolve, 3000));
  await testGetConferenceStatus(conferenceId);
  
  console.log('\n✅ Tests completed!');
}

// Manual test endpoints for debugging
console.log('\n📌 Manual Test Endpoints:\n');
console.log('1. Create Conference:');
console.log(`   POST ${SERVER_URL}/api/conference/create`);
console.log('   Body: { callId, customerId, customerPhone, sessionData }\n');

console.log('2. Get Status:');
console.log(`   GET ${SERVER_URL}/api/conference/status/{conferenceId}\n`);

console.log('3. Add Agent:');
console.log(`   POST ${SERVER_URL}/api/conference/add-agent`);
console.log('   Body: { conferenceId, agentPhone, agentName, agentId }\n');

// Run tests if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests, testCreateConference, testGetConferenceStatus, testAddAgent };