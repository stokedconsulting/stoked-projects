import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ActivityTracker, AgentActivityEvent } from '../activity-tracker';

suite('ActivityTracker Tests', () => {
    let testWorkspace: string;
    let activityTracker: ActivityTracker;

    setup(() => {
        // Create temporary workspace for testing
        testWorkspace = path.join(__dirname, 'test-workspace-' + Date.now());
        fs.mkdirSync(testWorkspace, { recursive: true });
        activityTracker = new ActivityTracker(testWorkspace);
    });

    teardown(() => {
        // Clean up test workspace
        if (fs.existsSync(testWorkspace)) {
            fs.rmSync(testWorkspace, { recursive: true, force: true });
        }
    });

    test('AC-5.1.a: Activity feed displays last 50 events', () => {
        // Log 60 events
        for (let i = 0; i < 60; i++) {
            const event: AgentActivityEvent = {
                timestamp: new Date().toISOString(),
                agentId: `agent-${i % 3}`,
                eventType: 'claimed',
                projectNumber: i,
                details: `Test event ${i}`
            };
            activityTracker.logAgentActivity(event);
        }

        // Get recent activity
        const activities = activityTracker.getRecentActivity(50);

        // Should return exactly 50 events (most recent)
        assert.strictEqual(activities.length, 50, 'Should return exactly 50 events');

        // Verify most recent event is first (reverse chronological)
        assert.strictEqual(activities[0].details, 'Test event 59', 'Most recent event should be first');
        assert.strictEqual(activities[49].details, 'Test event 10', 'Oldest event should be last');
    });

    test('AC-5.1.b: New events appear in activity feed', () => {
        // Log initial event
        const event1: AgentActivityEvent = {
            timestamp: new Date().toISOString(),
            agentId: 'agent-1',
            eventType: 'claimed',
            projectNumber: 42
        };
        activityTracker.logAgentActivity(event1);

        // Verify event is logged
        let activities = activityTracker.getRecentActivity(10);
        assert.strictEqual(activities.length, 1, 'Should have 1 event');
        assert.strictEqual(activities[0].agentId, 'agent-1', 'Event should match');

        // Log another event
        const event2: AgentActivityEvent = {
            timestamp: new Date().toISOString(),
            agentId: 'agent-2',
            eventType: 'completed',
            projectNumber: 42,
            details: 'APPROVED'
        };
        activityTracker.logAgentActivity(event2);

        // Verify new event appears
        activities = activityTracker.getRecentActivity(10);
        assert.strictEqual(activities.length, 2, 'Should have 2 events');
        assert.strictEqual(activities[0].agentId, 'agent-2', 'Most recent event should be agent-2');
        assert.strictEqual(activities[0].eventType, 'completed', 'Event type should be completed');
    });

    test('AC-5.1.e: Activity feed FIFO - oldest events removed when exceeding 50', () => {
        // Log 50 events
        for (let i = 0; i < 50; i++) {
            const event: AgentActivityEvent = {
                timestamp: new Date().toISOString(),
                agentId: `agent-${i % 3}`,
                eventType: 'claimed',
                projectNumber: i,
                details: `Event ${i}`
            };
            activityTracker.logAgentActivity(event);
        }

        // Verify we have 50 events
        let activities = activityTracker.getRecentActivity(50);
        assert.strictEqual(activities.length, 50, 'Should have exactly 50 events');
        assert.strictEqual(activities[49].details, 'Event 0', 'Oldest event should be Event 0');

        // Add one more event (should push out the oldest)
        const event51: AgentActivityEvent = {
            timestamp: new Date().toISOString(),
            agentId: 'agent-1',
            eventType: 'completed',
            projectNumber: 100,
            details: 'Event 51'
        };
        activityTracker.logAgentActivity(event51);

        // Verify still 50 events, but oldest changed
        activities = activityTracker.getRecentActivity(50);
        assert.strictEqual(activities.length, 50, 'Should still have exactly 50 events');
        assert.strictEqual(activities[0].details, 'Event 51', 'Newest event should be Event 51');
        assert.strictEqual(activities[49].details, 'Event 1', 'Oldest event should now be Event 1');

        // Event 0 should be gone
        const hasEvent0 = activities.some(a => a.details === 'Event 0');
        assert.strictEqual(hasEvent0, false, 'Event 0 should have been removed (FIFO)');
    });

    test('Clear activity log removes all events', () => {
        // Log some events
        for (let i = 0; i < 10; i++) {
            const event: AgentActivityEvent = {
                timestamp: new Date().toISOString(),
                agentId: 'agent-1',
                eventType: 'claimed',
                projectNumber: i
            };
            activityTracker.logAgentActivity(event);
        }

        // Verify events exist
        let activities = activityTracker.getRecentActivity(10);
        assert.strictEqual(activities.length, 10, 'Should have 10 events before clear');

        // Clear activity
        activityTracker.clearOldActivity();

        // Verify all events removed
        activities = activityTracker.getRecentActivity(10);
        assert.strictEqual(activities.length, 0, 'Should have 0 events after clear');
    });

    test('Activity tracker persists to file', () => {
        // Log an event
        const event: AgentActivityEvent = {
            timestamp: new Date().toISOString(),
            agentId: 'agent-1',
            eventType: 'claimed',
            projectNumber: 42,
            details: 'Test persistence'
        };
        activityTracker.logAgentActivity(event);

        // Create new tracker instance (should load from file)
        const newTracker = new ActivityTracker(testWorkspace);
        const activities = newTracker.getRecentActivity(10);

        // Verify event was persisted
        assert.strictEqual(activities.length, 1, 'Should have 1 event from file');
        assert.strictEqual(activities[0].agentId, 'agent-1', 'Event should match');
        assert.strictEqual(activities[0].details, 'Test persistence', 'Event details should match');
    });

    test('Get activity count returns correct number', () => {
        // Initially should be 0
        assert.strictEqual(activityTracker.getActivityCount(), 0, 'Should start with 0 events');

        // Log 5 events
        for (let i = 0; i < 5; i++) {
            const event: AgentActivityEvent = {
                timestamp: new Date().toISOString(),
                agentId: 'agent-1',
                eventType: 'claimed',
                projectNumber: i
            };
            activityTracker.logAgentActivity(event);
        }

        // Should have 5 events
        assert.strictEqual(activityTracker.getActivityCount(), 5, 'Should have 5 events');
    });

    test('Activity tracker handles all event types', () => {
        const eventTypes: Array<AgentActivityEvent['eventType']> = [
            'claimed',
            'completed',
            'reviewed',
            'ideated',
            'created',
            'paused',
            'resumed',
            'error'
        ];

        // Log one event of each type
        eventTypes.forEach((eventType, i) => {
            const event: AgentActivityEvent = {
                timestamp: new Date().toISOString(),
                agentId: `agent-${i}`,
                eventType,
                projectNumber: i,
                details: `Testing ${eventType}`
            };
            activityTracker.logAgentActivity(event);
        });

        // Verify all events logged
        const activities = activityTracker.getRecentActivity(10);
        assert.strictEqual(activities.length, eventTypes.length, 'Should have all event types');

        // Verify each event type is present
        eventTypes.forEach(eventType => {
            const hasType = activities.some(a => a.eventType === eventType);
            assert.strictEqual(hasType, true, `Should have ${eventType} event`);
        });
    });

    test('Activity tracker handles optional fields', () => {
        // Event with minimal fields
        const minimalEvent: AgentActivityEvent = {
            timestamp: new Date().toISOString(),
            agentId: 'agent-1',
            eventType: 'paused'
        };
        activityTracker.logAgentActivity(minimalEvent);

        // Event with all optional fields
        const fullEvent: AgentActivityEvent = {
            timestamp: new Date().toISOString(),
            agentId: 'agent-2',
            eventType: 'completed',
            projectNumber: 42,
            issueNumber: 7,
            details: 'All fields present'
        };
        activityTracker.logAgentActivity(fullEvent);

        // Verify both events stored correctly
        const activities = activityTracker.getRecentActivity(10);
        assert.strictEqual(activities.length, 2, 'Should have 2 events');

        const minimal = activities.find(a => a.agentId === 'agent-1');
        const full = activities.find(a => a.agentId === 'agent-2');

        assert.ok(minimal, 'Minimal event should exist');
        assert.ok(full, 'Full event should exist');
        assert.strictEqual(minimal?.projectNumber, undefined, 'Minimal event should not have projectNumber');
        assert.strictEqual(full?.projectNumber, 42, 'Full event should have projectNumber');
        assert.strictEqual(full?.issueNumber, 7, 'Full event should have issueNumber');
    });
});
