import * as vscode from 'vscode';
import { PlaywrightViewProvider } from './playwrightViewProvider';
import { ChatViewProvider } from './chatViewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Playwright Assistant extension is now active');

    // Register Playwright Viewer panel
    const playwrightProvider = new PlaywrightViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'playwrightViewer',
            playwrightProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // Register Chat panel
    const chatProvider = new ChatViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'chatbotPanel',
            chatProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.refresh', () => {
            playwrightProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.clearChat', () => {
            chatProvider.clearChat();
        })
    );

    // Recording commands
    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.startRecording', () => {
            playwrightProvider.startRecording();
            vscode.window.showInformationMessage('Recording started');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.stopRecording', () => {
            playwrightProvider.stopRecording();
            vscode.window.showInformationMessage('Recording stopped');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.exportCode', () => {
            playwrightProvider.exportCode();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.clearRecording', () => {
            playwrightProvider.clearRecording();
            vscode.window.showInformationMessage('Recording cleared');
        })
    );

    // Annotation mode toggle
    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.toggleAnnotationMode', () => {
            playwrightProvider.toggleAnnotationMode();
        })
    );

    // ================== Collaboration Commands ==================

    // Create a new collaboration session
    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.createSession', async () => {
            const sessionName = await vscode.window.showInputBox({
                prompt: 'Enter a name for the collaboration session',
                placeHolder: 'My Collaboration Session',
                value: 'Collaboration Session'
            });

            if (sessionName === undefined) {
                return; // User cancelled
            }

            const participantName = await vscode.window.showInputBox({
                prompt: 'Enter your display name',
                placeHolder: 'Your Name',
                value: 'Host'
            });

            if (participantName === undefined) {
                return; // User cancelled
            }

            playwrightProvider.createCollaborationSession(sessionName, participantName);
            vscode.window.showInformationMessage('Creating collaboration session...');
        })
    );

    // Join an existing collaboration session
    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.joinSession', async () => {
            const inviteCode = await vscode.window.showInputBox({
                prompt: 'Enter the session invite code',
                placeHolder: 'ABCD12',
                validateInput: (value) => {
                    if (!value || value.length !== 6) {
                        return 'Invite code must be 6 characters';
                    }
                    return null;
                }
            });

            if (!inviteCode) {
                return; // User cancelled
            }

            const participantName = await vscode.window.showInputBox({
                prompt: 'Enter your display name',
                placeHolder: 'Your Name',
                value: 'Guest'
            });

            if (participantName === undefined) {
                return; // User cancelled
            }

            playwrightProvider.joinCollaborationSession(inviteCode.toUpperCase(), participantName);
            vscode.window.showInformationMessage('Joining collaboration session...');
        })
    );

    // Leave the current collaboration session
    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.leaveSession', () => {
            playwrightProvider.leaveCollaborationSession();
            vscode.window.showInformationMessage('Left collaboration session');
        })
    );

    // Copy the current session's invite code
    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.copyInviteCode', async () => {
            const inviteCode = playwrightProvider.getSessionInviteCode();
            if (inviteCode) {
                await vscode.env.clipboard.writeText(inviteCode);
                vscode.window.showInformationMessage(`Invite code copied: ${inviteCode}`);
            } else {
                vscode.window.showWarningMessage('No active collaboration session');
            }
        })
    );

    // Show session info
    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.sessionInfo', () => {
            playwrightProvider.showSessionInfo();
        })
    );

    // Create collaboration status bar item
    const collaborationStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    collaborationStatusBar.text = '$(broadcast) Collaborate';
    collaborationStatusBar.tooltip = 'Start or join a collaboration session';
    collaborationStatusBar.command = 'playwrightAssistant.showCollaborationMenu';
    context.subscriptions.push(collaborationStatusBar);

    // Show collaboration menu
    context.subscriptions.push(
        vscode.commands.registerCommand('playwrightAssistant.showCollaborationMenu', async () => {
            const sessionActive = playwrightProvider.isCollaborationActive();

            const items = sessionActive
                ? [
                    { label: '$(sign-out) Leave Session', command: 'playwrightAssistant.leaveSession' },
                    { label: '$(copy) Copy Invite Code', command: 'playwrightAssistant.copyInviteCode' },
                    { label: '$(info) Session Info', command: 'playwrightAssistant.sessionInfo' }
                ]
                : [
                    { label: '$(add) Create Session', command: 'playwrightAssistant.createSession' },
                    { label: '$(plug) Join Session', command: 'playwrightAssistant.joinSession' }
                ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: sessionActive ? 'Collaboration Session Active' : 'Start Collaborating'
            });

            if (selected) {
                vscode.commands.executeCommand(selected.command);
            }
        })
    );

    // Show status bar item
    collaborationStatusBar.show();

    // Update status bar based on collaboration state
    playwrightProvider.onCollaborationStateChange((state) => {
        if (state.active) {
            collaborationStatusBar.text = `$(broadcast) Live (${state.participantCount})`;
            collaborationStatusBar.tooltip = `Collaboration session active - ${state.participantCount} participant(s)`;
            collaborationStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            collaborationStatusBar.text = '$(broadcast) Collaborate';
            collaborationStatusBar.tooltip = 'Start or join a collaboration session';
            collaborationStatusBar.backgroundColor = undefined;
        }
    });
}

export function deactivate() {
    console.log('Playwright Assistant extension deactivated');
}
