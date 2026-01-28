/*---------------------------------------------------------------------------------------------
 *  Playwright Assistant Contribution - Main registration file
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { registerAction2, Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

import {
	PLAYWRIGHT_ASSISTANT_VIEWLET_ID,
	PLAYWRIGHT_VIEWER_VIEW_ID,
	PLAYWRIGHT_CHAT_VIEW_ID,
	IPlaywrightService
} from '../common/playwrightAssistant.js';
import { PlaywrightService } from './playwrightService.js';
import { PlaywrightViewPane } from './playwrightViewPane.js';
import { PlaywrightChatViewPane } from './chatViewPane.js';
import { PlaywrightViewPaneContainer } from './playwrightViewPaneContainer.js';

// Register the icon for the activity bar
const playwrightViewIcon = registerIcon('playwright-assistant-view-icon', Codicon.play, localize('playwrightViewIcon', 'View icon of the Playwright Assistant view.'));

// Register View Container (Activity Bar Icon)
const viewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: PLAYWRIGHT_ASSISTANT_VIEWLET_ID,
	title: localize2('playwrightAssistant', 'Playwright Assistant'),
	ctorDescriptor: new SyncDescriptor(PlaywrightViewPaneContainer),
	storageId: 'workbench.playwrightAssistant.views.state',
	icon: playwrightViewIcon,
	alwaysUseContainerInfo: true,
	order: 10,
	hideIfEmpty: false,
}, ViewContainerLocation.Sidebar, { doNotRegisterOpenCommand: false });

// Register Views
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

// Playwright Viewer View (60% of space)
viewsRegistry.registerViews([{
	id: PLAYWRIGHT_VIEWER_VIEW_ID,
	name: localize2('playwrightViewer', 'Browser Viewer'),
	containerIcon: playwrightViewIcon,
	ctorDescriptor: new SyncDescriptor(PlaywrightViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	weight: 60,
	order: 1,
	collapsed: false,
}], viewContainer);

// Chat View (40% of space)
viewsRegistry.registerViews([{
	id: PLAYWRIGHT_CHAT_VIEW_ID,
	name: localize2('playwrightChat', 'Chat'),
	containerIcon: playwrightViewIcon,
	ctorDescriptor: new SyncDescriptor(PlaywrightChatViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	weight: 40,
	order: 2,
	collapsed: false,
}], viewContainer);

// Register welcome content for viewer
viewsRegistry.registerViewWelcomeContent(PLAYWRIGHT_VIEWER_VIEW_ID, {
	content: localize('playwrightWelcome', 'Connect to a Playwright browser session to view and interact with web pages.'),
	when: ContextKeyExpr.true()
});

// Register welcome content for chat
viewsRegistry.registerViewWelcomeContent(PLAYWRIGHT_CHAT_VIEW_ID, {
	content: localize('chatWelcome', 'Chat with your AI assistant about the browser session.'),
	when: ContextKeyExpr.true()
});

// Register Playwright Service
registerSingleton(IPlaywrightService, PlaywrightService, InstantiationType.Eager);

// Register Configuration
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'playwrightAssistant',
	title: localize('playwrightAssistantConfigTitle', 'Playwright Assistant'),
	type: 'object',
	properties: {
		'playwrightAssistant.relayServerUrl': {
			type: 'string',
			default: 'ws://localhost:8765',
			description: localize('relayServerUrl', 'WebSocket URL for the Playwright relay server.')
		},
		'playwrightAssistant.chatApiUrl': {
			type: 'string',
			default: 'http://localhost:8766/chat',
			description: localize('chatApiUrl', 'HTTP URL for the chat API server.')
		},
		'playwrightAssistant.screenshotInterval': {
			type: 'number',
			default: 200,
			minimum: 50,
			maximum: 5000,
			description: localize('screenshotInterval', 'Interval in milliseconds between screenshot updates.')
		},
		'playwrightAssistant.vncUrl': {
			type: 'string',
			default: 'ws://localhost:6080/websockify',
			description: localize('vncUrl', 'WebSocket URL for VNC connection (optional).')
		},
		'playwrightAssistant.autoConnect': {
			type: 'boolean',
			default: true,
			description: localize('autoConnect', 'Automatically connect to the relay server on startup.')
		}
	}
});

// Register Actions

// Refresh action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'playwrightAssistant.refresh',
			title: localize2('refresh', 'Refresh'),
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', PLAYWRIGHT_VIEWER_VIEW_ID),
				group: 'navigation',
				order: 1
			},
			icon: Codicon.refresh
		});
	}

	run(accessor: ServicesAccessor): void {
		const playwrightService = accessor.get(IPlaywrightService);
		playwrightService.reload();
	}
});

// Clear chat action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'playwrightAssistant.clearChat',
			title: localize2('clearChat', 'Clear Chat'),
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', PLAYWRIGHT_CHAT_VIEW_ID),
				group: 'navigation',
				order: 1
			},
			icon: Codicon.clearAll
		});
	}

	run(_accessor: ServicesAccessor): void {
		// Will be handled by the chat view pane
		console.log('Clear chat requested');
	}
});

// Start recording action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'playwrightAssistant.startRecording',
			title: localize2('startRecording', 'Start Recording'),
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', PLAYWRIGHT_VIEWER_VIEW_ID),
				group: 'navigation',
				order: 2
			},
			icon: Codicon.record
		});
	}

	run(accessor: ServicesAccessor): void {
		const playwrightService = accessor.get(IPlaywrightService);
		playwrightService.startRecording();
	}
});

// Stop recording action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'playwrightAssistant.stopRecording',
			title: localize2('stopRecording', 'Stop Recording'),
			icon: Codicon.debugStop
		});
	}

	run(accessor: ServicesAccessor): void {
		const playwrightService = accessor.get(IPlaywrightService);
		playwrightService.stopRecording();
	}
});

// Toggle annotation mode action
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'playwrightAssistant.toggleAnnotationMode',
			title: localize2('toggleAnnotationMode', 'Toggle Annotation Mode'),
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', PLAYWRIGHT_VIEWER_VIEW_ID),
				group: 'navigation',
				order: 3
			},
			icon: Codicon.edit
		});
	}

	run(_accessor: ServicesAccessor): void {
		// Will be handled by the viewer pane
		console.log('Toggle annotation mode requested');
	}
});

// Open Playwright Assistant command with keybinding
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'playwrightAssistant.openView',
			title: localize2('openPlaywrightAssistant', 'Open Playwright Assistant'),
			category: localize2('viewCategory', 'View'),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyB,
				when: undefined
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		await viewsService.openViewContainer(PLAYWRIGHT_ASSISTANT_VIEWLET_ID);
	}
});

// Collaboration actions
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'playwrightAssistant.createSession',
			title: localize2('createSession', 'Create Collaboration Session'),
			category: localize2('playwrightAssistantCategory', 'Playwright Assistant')
		});
	}

	run(_accessor: ServicesAccessor): void {
		// Will prompt for session name and create
		console.log('Create collaboration session requested');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'playwrightAssistant.joinSession',
			title: localize2('joinSession', 'Join Collaboration Session'),
			category: localize2('playwrightAssistantCategory', 'Playwright Assistant')
		});
	}

	run(_accessor: ServicesAccessor): void {
		// Will prompt for invite code and join
		console.log('Join collaboration session requested');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'playwrightAssistant.leaveSession',
			title: localize2('leaveSession', 'Leave Collaboration Session'),
			category: localize2('playwrightAssistantCategory', 'Playwright Assistant')
		});
	}

	run(accessor: ServicesAccessor): void {
		const playwrightService = accessor.get(IPlaywrightService);
		playwrightService.leaveCollaborationSession();
	}
});

// Workbench Contribution for auto-initialization
class PlaywrightAssistantContribution extends Disposable {
	static readonly ID = 'workbench.contrib.playwrightAssistant';

	constructor(
		@IPlaywrightService _playwrightService: IPlaywrightService
	) {
		super();

		// The service auto-connects, but we can add additional initialization here
		// _playwrightService is injected to ensure initialization
		console.log('Playwright Assistant initialized');
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(PlaywrightAssistantContribution, LifecyclePhase.Restored);
