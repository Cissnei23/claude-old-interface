class ClaudeChat {
    constructor() {
        const defaultCustomBaseUrl = 'https://api.ofox.ai/v1';
        const defaultCustomModel = 'sonnet-4-5-20250929';
        this.apiKey = localStorage.getItem('claude_api_key') || '';
        this.provider = localStorage.getItem('claude_provider') || (this.apiKey ? 'custom' : 'mock');
        if (!['mock', 'custom', 'claudeCode'].includes(this.provider)) this.provider = 'mock';
        // A persisted Custom relay selection without a key cannot send a
        // request. Keep the first-run experience usable with the local mock
        // until the user supplies credentials in Settings.
        if (this.provider === 'custom' && !this.apiKey.trim()) this.provider = 'mock';
        this.customBaseUrl = localStorage.getItem('claude_custom_base_url') || defaultCustomBaseUrl;
        this.customModel = localStorage.getItem('claude_custom_model') || defaultCustomModel;
        this.model = localStorage.getItem('claude_model') || 'claude-sonnet-4-5';
        if (!['claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5'].includes(this.model)) {
            this.model = 'claude-sonnet-4-5';
        }
        this.conversations = this.readLocalCollection('claude_conversations');
        this.projects = this.readLocalCollection('claude_projects');
        this.artifacts = this.readLocalCollection('claude_artifacts');
        this.currentConversationId = null;
        this.currentProjectId = null;
        this.currentProjectChatId = null;
        this.projectChatMode = false;
        this.currentArtifactId = null;
        this.pendingAttachments = [];
        this.pendingProjectConversation = null;
        this.chatStyle = localStorage.getItem('claude_chat_style') || 'Normal';
        this.toolAccess = localStorage.getItem('claude_tool_access') || 'Auto';
        this.thinkingEnabled = localStorage.getItem('claude_thinking_enabled') === 'true';
        this.currentTab = 'chats';
        this.currentView = 'chat';
        this.contextVersion = 2;
        this.sharedStateSaveTimer = null;
        this.sharedStateReady = false;
        this.sharedStateUpdatedAt = null;
        this.editingMessageIndex = null;

        this.repairArtifactDrawerMarkup();
        this.initElements();
        this.initEventListeners();
        this.setupMobileViewport();
        this.applyModelSelection(this.model);
        this.thinkingBtn.classList.toggle('active', this.thinkingEnabled);
        this.thinkingBtn.setAttribute('aria-pressed', String(this.thinkingEnabled));
        this.thinkingBtn.setAttribute('aria-label', this.thinkingEnabled ? 'Disable extended thinking' : 'Enable extended thinking');
        this.restoreAddToggleValues();
        this.syncSendButtonState();
        this.loadConversations();

        if (this.conversations.length > 0) {
            this.loadConversation(this.conversations[0].id);
        } else {
            this.messagesContainer.innerHTML = this.getWelcomeMarkup();
        }
        this.renderContextPills();
        this.syncArtifactsFromServer()
            .then(() => this.renderContextPills())
            .catch(error => console.warn('Artifact sync unavailable', error));
        this.syncSharedStateFromServer();
        window.addEventListener('focus', () => {
            if (this.sharedStateReady) this.syncSharedStateFromServer();
        });
    }

    readLocalCollection(key) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(value) ? value : [];
        } catch (error) {
            console.warn(`Ignoring invalid local data in ${key}`, error);
            return [];
        }
    }

    setupMobileViewport() {
        const viewport = window.visualViewport;
        const update = () => {
            const height = Math.round(viewport?.height || window.innerHeight);
            document.documentElement.style.setProperty('--app-height', `${height}px`);
            const keyboardOpen = Boolean(viewport && window.innerHeight - viewport.height > 140);
            document.body.classList.toggle('keyboard-open', keyboardOpen);
            if (keyboardOpen && document.activeElement === this.messageInput) {
                requestAnimationFrame(() => this.scrollConversationToBottom(false));
            }
        };
        update();
        window.addEventListener('resize', update, { passive: true });
        window.addEventListener('orientationchange', update, { passive: true });
        viewport?.addEventListener('resize', update, { passive: true });
        viewport?.addEventListener('scroll', update, { passive: true });
        this.messageInput.addEventListener('focus', () => {
            window.setTimeout(() => {
                update();
                this.scrollConversationToBottom(false);
            }, 120);
        });
    }

    repairArtifactDrawerMarkup() {
        const actions = document.querySelector('.artifact-drawer-actions');
        if (!actions) return;
        actions.innerHTML = `
            <button id="artifactDrawerMenuBtn" class="artifact-icon-btn" type="button" aria-label="Artifact options">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="10" r="1.5"></circle><circle cx="10" cy="10" r="1.5"></circle><circle cx="15" cy="10" r="1.5"></circle>
                </svg>
            </button>
            <button id="artifactDrawerClose" class="artifact-icon-btn" type="button" aria-label="Close artifact">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
                    <path d="M5 5l10 10M15 5L5 15" stroke-width="1.8" stroke-linecap="round"></path>
                </svg>
            </button>
            <div class="artifact-drawer-menu" id="artifactDrawerMenu" hidden>
                <button id="artifactDrawerViewToggle" type="button">
                    <span><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="M2.5 10s2.8-5 7.5-5 7.5 5 7.5 5-2.8 5-7.5 5-7.5-5-7.5-5Z" stroke-width="1.5"></path><circle cx="10" cy="10" r="2.2" stroke-width="1.5"></circle></svg></span>
                    <span>Preview</span>
                </button>
                <button id="artifactDrawerCopy" type="button">
                    <span><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><rect x="7" y="6" width="9" height="11" rx="1.5" stroke-width="1.5"></rect><path d="M4 13V4.5A1.5 1.5 0 0 1 5.5 3H13" stroke-width="1.5" stroke-linecap="round"></path></svg></span>
                    <span>Copy code</span>
                </button>
                <button id="artifactDrawerMenuClose" type="button">
                    <span><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke-width="1.7" stroke-linecap="round"></path></svg></span>
                    <span>Close</span>
                </button>
            </div>`;
    }

    initElements() {
        // 侧边栏
        this.sidebar = document.getElementById('sidebar');
        this.menuBtn = document.getElementById('menuBtn');
        this.sidebarCloseBtn = document.getElementById('sidebarCloseBtn');
        this.sidebarDismiss = document.getElementById('sidebarDismiss');
        this.sidebarNewBtn = document.getElementById('sidebarNewBtn');
        this.navItems = document.querySelectorAll('.nav-item');

        // 主聊天区域
        this.chatMain = document.querySelector('.chat-main');
        this.modelSelector = document.getElementById('modelSelector');
        this.modelMenu = document.getElementById('modelMenu');
        this.conversationMenu = document.getElementById('conversationMenu');
        this.conversationMenuTitle = document.getElementById('conversationMenuTitle');
        this.conversationChangeProject = document.getElementById('conversationChangeProject');
        this.conversationStar = document.getElementById('conversationStar');
        this.conversationRename = document.getElementById('conversationRename');
        this.conversationDelete = document.getElementById('conversationDelete');
        this.conversationThinking = document.getElementById('conversationThinking');
        this.modelOptions = document.querySelectorAll('.model-option');
        this.currentModelSpan = document.getElementById('currentModel');
        this.incognitoBtn = document.getElementById('incognitoBtn');
        this.messagesContainer = document.getElementById('messagesContainer');
        this.scrollBottomBtn = document.getElementById('scrollBottomBtn');
        this.chatHistory = document.getElementById('chatHistory');
        this.messageInput = document.getElementById('messageInput');
        this.pendingAttachmentsEl = document.getElementById('pendingAttachments');
        this.addBtn = document.getElementById('addBtn');
        this.thinkingBtn = document.getElementById('thinkingBtn');
        this.micBtn = document.getElementById('micBtn');
        this.voiceBtn = document.getElementById('voiceBtn');
        this.contextPills = document.getElementById('contextPills');
        this.projectContextPill = document.getElementById('projectContextPill');
        this.artifactContextPill = document.getElementById('artifactContextPill');
        this.artifactContextTitle = document.getElementById('artifactContextTitle');

        // 模态框
        this.addModal = document.getElementById('addModal');
        this.closeAddModal = document.getElementById('closeAddModal');
        this.projectPickerModal = document.getElementById('projectPickerModal');
        this.closeProjectPicker = document.getElementById('closeProjectPicker');
        this.projectPickerList = document.getElementById('projectPickerList');
        this.projectPickerCreate = document.getElementById('projectPickerCreate');
        this.settingsModal = document.getElementById('settingsModal');
        this.openSettingsBtn = document.getElementById('openSettingsBtn');
        this.closeSettings = document.getElementById('closeSettings');
        this.saveSettings = document.getElementById('saveSettings');
        this.testConnectionBtn = document.getElementById('testConnectionBtn');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.apiKeyInput = document.getElementById('apiKeyInput');
        this.providerSelect = document.getElementById('providerSelect');
        this.customBaseUrlInput = document.getElementById('customBaseUrlInput');
        this.customModelInput = document.getElementById('customModelInput');
        this.modelSelect = document.getElementById('modelSelect');
        this.exportBackupBtn = document.getElementById('exportBackupBtn');
        this.importBackupBtn = document.getElementById('importBackupBtn');
        this.backupImportInput = document.getElementById('backupImportInput');
        this.actionDialog = document.getElementById('actionDialog');
        this.actionDialogTitle = document.getElementById('actionDialogTitle');
        this.actionDialogMessage = document.getElementById('actionDialogMessage');
        this.actionDialogInput = document.getElementById('actionDialogInput');
        this.actionDialogCancel = document.getElementById('actionDialogCancel');
        this.actionDialogConfirm = document.getElementById('actionDialogConfirm');
        this.actionDialogHandler = null;

        // Projects
        this.projectView = document.getElementById('projectView');
        this.backToChats = document.getElementById('backToChats');
        this.projectTitle = document.getElementById('projectTitle');
        this.starBtn = document.getElementById('starBtn');
        this.projectMenuBtn = document.getElementById('projectMenuBtn');
        this.projectActionMenu = document.getElementById('projectActionMenu');
        this.projectRenameAction = document.getElementById('projectRenameAction');
        this.projectStarAction = document.getElementById('projectStarAction');
        this.projectDeleteAction = document.getElementById('projectDeleteAction');
        this.filesTab = document.getElementById('filesTab');
        this.instructionsTab = document.getElementById('instructionsTab');
        this.projectChats = document.getElementById('projectChats');
        this.newProjectChat = document.getElementById('newProjectChat');
        this.filesCount = document.getElementById('filesCount');

        // 创建项目
        this.createProjectModal = document.getElementById('createProjectModal');
        this.closeCreateProject = document.getElementById('closeCreateProject');
        this.projectNameInput = document.getElementById('projectNameInput');
        this.createProjectBtn = document.getElementById('createProjectBtn');

        // Instructions
        this.instructionsModal = document.getElementById('instructionsModal');
        this.closeInstructions = document.getElementById('closeInstructions');
        this.saveInstructions = document.getElementById('saveInstructions');
        this.instructionsText = document.getElementById('instructionsText');

        // Project Files
        this.filesDrawerOverlay = document.getElementById('filesDrawerOverlay');
        this.filesDrawer = document.getElementById('filesDrawer');
        this.closeFilesDrawer = document.getElementById('closeFilesDrawer');
        this.capacityFill = document.getElementById('capacityFill');
        this.capacityText = document.getElementById('capacityText');
        this.filesGrid = document.getElementById('filesGrid');
        this.addFilesBtn = document.getElementById('addFilesBtn');

        // Artifacts
        this.artifactView = document.getElementById('artifactView');
        this.artifactBackBtn = document.getElementById('artifactBackBtn');
        this.newArtifactBtn = document.getElementById('newArtifactBtn');
        this.emptyCreateArtifact = document.getElementById('emptyCreateArtifact');
        this.openArtifactsFromProject = document.getElementById('openArtifactsFromProject');
        this.projectChatsWorkspace = document.getElementById('projectChatsWorkspace');
        this.projectArtifactsList = document.getElementById('projectArtifactsList');
        this.openProjectsFromArtifacts = document.getElementById('openProjectsFromArtifacts');
        this.artifactCount = document.getElementById('artifactCount');
        this.artifactList = document.getElementById('artifactList');
        this.artifactEditor = document.getElementById('artifactEditor');
        this.artifactEmpty = document.getElementById('artifactEmpty');
        this.artifactDocument = document.getElementById('artifactDocument');
        this.artifactTitleInput = document.getElementById('artifactTitleInput');
        this.artifactTypeSelect = document.getElementById('artifactTypeSelect');
        this.deleteArtifactBtn = document.getElementById('deleteArtifactBtn');
        this.artifactEditMode = document.getElementById('artifactEditMode');
        this.artifactPreviewMode = document.getElementById('artifactPreviewMode');
        this.artifactSource = document.getElementById('artifactSource');
        this.artifactPreview = document.getElementById('artifactPreview');
        this.artifactSaveState = document.getElementById('artifactSaveState');
        this.artifactDrawerBackdrop = document.getElementById('artifactDrawerBackdrop');
        this.artifactListBackdrop = document.getElementById('artifactListBackdrop');
        this.artifactListSheet = document.getElementById('artifactListSheet');
        this.artifactListClose = document.getElementById('artifactListClose');
        this.conversationArtifactList = document.getElementById('conversationArtifactList');
        this.artifactDownloadAll = document.getElementById('artifactDownloadAll');
        this.artifactDrawer = document.getElementById('artifactDrawer');
        this.artifactDrawerTitle = document.getElementById('artifactDrawerTitle');
        this.artifactDrawerSelect = document.getElementById('artifactDrawerSelect');
        this.artifactDrawerMenuBtn = document.getElementById('artifactDrawerMenuBtn');
        this.artifactDrawerClose = document.getElementById('artifactDrawerClose');
        this.artifactDrawerMenu = document.getElementById('artifactDrawerMenu');
        this.artifactDrawerViewToggle = document.getElementById('artifactDrawerViewToggle');
        this.artifactDrawerCopy = document.getElementById('artifactDrawerCopy');
        this.artifactDrawerMenuClose = document.getElementById('artifactDrawerMenuClose');
        this.artifactDrawerSource = document.getElementById('artifactDrawerSource');
        this.artifactDrawerPreview = document.getElementById('artifactDrawerPreview');
    }

    initEventListeners() {
        // 侧边栏
        this.menuBtn.addEventListener('click', () => {
            if (this.projectChatMode) {
                this.exitProjectChat();
            } else {
                this.toggleSidebar();
            }
        });
        this.sidebarCloseBtn.addEventListener('click', () => this.toggleSidebar());
        this.sidebarDismiss.addEventListener('click', () => this.setSidebarOpen(false));
        this.sidebarNewBtn.addEventListener('click', () => {
            this.createNewConversation();
            this.toggleSidebar();
        });

        // 导航
        this.navItems.forEach(item => {
            item.addEventListener('click', () => {
                const tab = item.dataset.tab;
                this.switchTab(tab);
            });
        });

        // 顶部按钮
        this.modelSelector.addEventListener('click', (event) => {
            event.stopPropagation();
            if (this.isConversationLocked()) {
                this.modelMenu.style.display = 'none';
                this.toggleConversationMenu();
                return;
            }
            this.closeConversationMenu();
            // `style.display` is empty while the menu is hidden by CSS, so
            // checking it directly makes the first click close an already
            // hidden menu. Read the rendered state instead.
            const open = getComputedStyle(this.modelMenu).display !== 'none';
            this.modelMenu.style.display = open ? 'none' : 'block';
        });
        this.modelOptions.forEach(option => {
            option.addEventListener('click', () => this.applyModelSelection(option.dataset.model));
        });
        document.addEventListener('click', (event) => {
            if (!this.modelMenu.contains(event.target) && !this.modelSelector.contains(event.target)) {
                this.modelMenu.style.display = 'none';
            }
            if (!this.conversationMenu.contains(event.target) && !this.modelSelector.contains(event.target)) {
                this.closeConversationMenu();
            }
            if (!this.projectActionMenu.contains(event.target) && !this.projectMenuBtn.contains(event.target)) {
                this.projectActionMenu.hidden = true;
            }
        });
        this.conversationChangeProject.addEventListener('click', () => this.changeCurrentConversationProject());
        this.conversationStar.addEventListener('click', () => this.toggleCurrentConversationStar());
        this.conversationRename.addEventListener('click', () => this.renameCurrentConversation());
        this.conversationDelete.addEventListener('click', () => this.deleteCurrentConversation());
        this.conversationThinking.addEventListener('click', () => this.setThinkingEnabled(!this.thinkingEnabled));
        this.incognitoBtn.addEventListener('click', () => {
            console.log('Incognito mode clicked (no action)');
        });

        this.messagesContainer.addEventListener('scroll', () => this.syncScrollBottomButton(), { passive: true });
        this.scrollBottomBtn.addEventListener('click', () => this.scrollConversationToBottom(true));
        window.addEventListener('focus', () => this.refreshWelcomeGreeting());
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.refreshWelcomeGreeting();
        });

        // 输入
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        this.messageInput.addEventListener('input', () => this.syncSendButtonState());
        this.addBtn.addEventListener('click', () => this.openAddModal());
        this.thinkingBtn.addEventListener('click', () => {
            this.setThinkingEnabled(!this.thinkingEnabled);
        });
        this.micBtn.addEventListener('click', () => console.log('Mic clicked'));
        this.voiceBtn.addEventListener('click', () => {
            if (this.messageInput.value.trim()) this.sendMessage();
            else console.log('Voice clicked');
        });

        // 模态框
        this.closeAddModal.addEventListener('click', () => this.closeAddModalHandler());
        this.addModal.addEventListener('click', (e) => {
            if (e.target === this.addModal) this.closeAddModalHandler();
        });
        this.closeProjectPicker.addEventListener('click', () => this.closeProjectPickerModal());
        this.projectPickerModal.addEventListener('click', (e) => {
            if (e.target === this.projectPickerModal) this.closeProjectPickerModal();
        });
        this.projectPickerCreate.addEventListener('click', () => this.startCreateProjectForPendingChat());
        this.openSettingsBtn.addEventListener('click', () => this.openSettingsModal());
        this.closeSettings.addEventListener('click', () => this.closeSettingsModal());
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) this.closeSettingsModal();
        });
        this.saveSettings.addEventListener('click', () => this.saveSettingsData());
        this.testConnectionBtn.addEventListener('click', () => this.testCustomConnection());
        this.exportBackupBtn.addEventListener('click', () => this.exportLocalBackup());
        this.importBackupBtn.addEventListener('click', () => this.backupImportInput.click());
        this.backupImportInput.addEventListener('change', event => this.importLocalBackup(event.target.files?.[0]));
        this.actionDialogCancel.addEventListener('click', () => this.closeActionDialog());
        this.actionDialogConfirm.addEventListener('click', () => this.confirmActionDialog());
        this.actionDialog.addEventListener('click', event => {
            if (event.target === this.actionDialog) this.closeActionDialog();
        });

        // Projects
        this.backToChats.addEventListener('click', () => this.switchView('chat'));
        this.filesTab.addEventListener('click', () => this.openFilesDrawer());
        this.instructionsTab.addEventListener('click', () => this.openInstructionsModal());
        this.newProjectChat.addEventListener('click', () => this.createProjectChat());
        this.starBtn.addEventListener('click', () => this.toggleCurrentProjectStar());
        this.projectMenuBtn.addEventListener('click', event => {
            event.stopPropagation();
            this.projectActionMenu.hidden = !this.projectActionMenu.hidden;
            this.syncProjectActionMenu();
        });
        this.projectRenameAction.addEventListener('click', () => this.renameCurrentProject());
        this.projectStarAction.addEventListener('click', () => this.toggleCurrentProjectStar());
        this.projectDeleteAction.addEventListener('click', () => this.deleteCurrentProject());

        // 创建项目
        this.closeCreateProject.addEventListener('click', () => this.closeCreateProjectModal());
        this.createProjectBtn.addEventListener('click', () => this.createProject());
        this.projectNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.createProject();
        });

        // Instructions
        this.closeInstructions.addEventListener('click', () => this.closeInstructionsModal());
        this.saveInstructions.addEventListener('click', () => this.saveInstructionsData());

        // Files Drawer
        this.closeFilesDrawer.addEventListener('click', () => this.closeFilesDrawerHandler());
        this.filesDrawerOverlay.addEventListener('click', () => this.closeFilesDrawerHandler());
        this.addFilesBtn.addEventListener('click', () => this.handleAddFiles());

        // Artifacts
        this.artifactBackBtn.addEventListener('click', () => this.switchView('chat'));
        this.newArtifactBtn.addEventListener('click', () => this.createArtifact());
        this.emptyCreateArtifact.addEventListener('click', () => this.createArtifact());
        this.openArtifactsFromProject.addEventListener('click', () => this.showProjectArtifacts());
        this.projectChatsWorkspace.addEventListener('click', () => this.showProjectChats());
        this.openProjectsFromArtifacts.addEventListener('click', () => {
            if (this.projects.length > 0) this.openProject(this.projects[0].id);
            else this.openCreateProjectModal();
        });
        this.artifactTitleInput.addEventListener('input', () => this.updateCurrentArtifact());
        this.artifactTypeSelect.addEventListener('change', () => this.updateCurrentArtifact());
        this.artifactSource.addEventListener('input', () => this.updateCurrentArtifact());
        this.deleteArtifactBtn.addEventListener('click', () => this.deleteCurrentArtifact());
        this.artifactEditMode.addEventListener('click', () => this.setArtifactMode('edit'));
        this.artifactPreviewMode.addEventListener('click', () => this.setArtifactMode('preview'));
        this.projectContextPill.addEventListener('click', () => {
            if (this.currentProjectId) this.openProject(this.currentProjectId);
        });
        this.artifactContextPill.addEventListener('click', () => this.openConversationArtifactList());
        this.artifactListBackdrop.addEventListener('click', () => this.closeConversationArtifactList());
        this.artifactListClose.addEventListener('click', () => this.closeConversationArtifactList());
        this.artifactDownloadAll.addEventListener('click', () => this.downloadConversationArtifacts());
        this.artifactDrawerBackdrop.addEventListener('click', () => this.closeArtifactDrawer());
        this.artifactDrawerClose.addEventListener('click', () => this.closeArtifactDrawer());
        this.artifactDrawerMenuClose.addEventListener('click', () => this.closeArtifactDrawer());
        this.artifactDrawerMenuBtn.addEventListener('click', () => {
            this.artifactDrawerMenu.hidden = !this.artifactDrawerMenu.hidden;
        });
        this.artifactDrawerViewToggle.addEventListener('click', () => this.toggleArtifactDrawerView());
        this.artifactDrawerCopy.addEventListener('click', () => this.copyArtifactDrawerSource());
        this.artifactDrawerSource.addEventListener('input', () => this.updateArtifactFromDrawer());
        this.artifactDrawerSelect.addEventListener('change', () => {
            this.currentArtifactId = this.artifactDrawerSelect.value;
            const conversation = this.getActiveConversation();
            if (conversation) {
                conversation.artifactId = this.currentArtifactId;
                this.saveActiveConversation();
            }
            this.renderContextPills();
            this.openArtifactDrawer();
        });

        // Add to Chat 选项
        this.initAddToChat();
    }

    initAddToChat() {
        this.syncAddSettingsLabels();
        const addOptions = document.querySelectorAll('.add-option');
        addOptions.forEach((option) => {
            option.addEventListener('click', () => {
                const optionText = option.querySelector('span').textContent;
                if (optionText === 'Camera') {
                    this.handleCameraUpload();
                } else if (optionText === 'Photos') {
                    this.handlePhotosUpload();
                } else if (optionText === 'Files') {
                    this.handleFilesUpload();
                } else {
                    console.log(`${optionText} clicked (no action)`);
                }
            });
        });
        document.querySelectorAll('.setting-item').forEach((item) => {
            const label = item.querySelector('.setting-left span')?.textContent;
            if (label === 'Add to project') {
                item.addEventListener('click', () => this.handleAddCurrentChatToProject());
            } else if (label === 'Choose style') {
                item.addEventListener('click', () => this.cycleChatStyle(item));
            } else if (label === 'Tool access') {
                item.addEventListener('click', () => this.cycleToolAccess(item));
            }
        });
    }

    syncAddSettingsLabels() {
        document.querySelectorAll('.setting-item').forEach((item) => {
            const label = item.querySelector('.setting-left span')?.textContent;
            if (label === 'Choose style') item.querySelector('.setting-value').textContent = this.chatStyle;
            if (label === 'Tool access') item.querySelector('.setting-value').textContent = this.toolAccess;
        });
    }

    getAddToggleValue(label) {
        const items = Array.from(document.querySelectorAll('.toggle-item'));
        const item = items.find(node => node.querySelector('.toggle-left span')?.textContent === label);
        return Boolean(item?.querySelector('input')?.checked);
    }

    restoreAddToggleValues() {
        const defaults = { 'Research': false, 'Web search': true };
        document.querySelectorAll('.toggle-item').forEach(item => {
            const label = item.querySelector('.toggle-left span')?.textContent;
            const input = item.querySelector('input');
            if (!input || !(label in defaults)) return;
            const key = `claude_toggle_${label.toLowerCase().replace(/\s+/g, '_')}`;
            const saved = localStorage.getItem(key);
            input.checked = saved === null ? defaults[label] : saved === 'true';
            input.addEventListener('change', () => localStorage.setItem(key, String(input.checked)));
        });
    }

    cycleChatStyle(item) {
        const styles = ['Normal', 'Concise', 'Detailed'];
        const next = styles[(styles.indexOf(this.chatStyle) + 1) % styles.length];
        this.chatStyle = next;
        localStorage.setItem('claude_chat_style', next);
        item.querySelector('.setting-value').textContent = next;
    }

    cycleToolAccess(item) {
        const modes = ['Auto', 'Read only', 'Off'];
        const next = modes[(modes.indexOf(this.toolAccess) + 1) % modes.length];
        this.toolAccess = next;
        localStorage.setItem('claude_tool_access', next);
        item.querySelector('.setting-value').textContent = next;
    }

    handleCameraUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.onchange = async (e) => {
            await this.handlePickedAttachments(Array.from(e.target.files));
        };
        input.click();
    }

    handlePhotosUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = async (e) => {
            await this.handlePickedAttachments(Array.from(e.target.files));
        };
        input.click();
    }

    handleFilesUpload() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = async (e) => {
            await this.handlePickedAttachments(Array.from(e.target.files));
        };
        input.click();
    }

    async handlePickedAttachments(files) {
        this.closeAddModalHandler();
        if (!files.length) return;
        try {
            const uploaded = await Promise.all(files.map(file => this.uploadProjectBinaryFile(file)));
            this.pendingAttachments.push(...uploaded.map(file => ({
                id: file.id,
                name: file.name,
                type: file.type,
                size: file.size,
                relativePath: file.relativePath,
                vision: String(file.type || '').startsWith('image/')
            })));
            this.renderPendingAttachments();
            this.messageInput.focus();
        } catch (error) {
            alert(error.message || 'Could not attach file');
        }
    }

    renderPendingAttachments() {
        if (!this.pendingAttachmentsEl) return;
        this.pendingAttachmentsEl.innerHTML = '';
        this.pendingAttachmentsEl.hidden = this.pendingAttachments.length === 0;
        this.pendingAttachments.forEach(file => {
            const chip = document.createElement('button');
            chip.className = 'pending-attachment';
            chip.type = 'button';
            chip.title = 'Remove attachment';
            chip.innerHTML = `
                <span class="pending-attachment-type">${this.escapeHtml(file.vision ? 'Image' : this.getFileType(file.name))}</span>
                <span class="pending-attachment-name">${this.escapeHtml(file.name)}</span>
                <span class="pending-attachment-remove">×</span>`;
            chip.addEventListener('click', () => {
                this.pendingAttachments = this.pendingAttachments.filter(item => item.id !== file.id);
                this.renderPendingAttachments();
            });
            this.pendingAttachmentsEl.appendChild(chip);
        });
    }

    handleAddCurrentChatToProject() {
        this.closeAddModalHandler();
        if (this.projectChatMode) {
            this.openFilesDrawer();
            return;
        }
        const conversation = this.getActiveConversation();
        if (!conversation || conversation.messages.length === 0) {
            alert('Start a conversation first, then add it to a project.');
            return;
        }
        this.pendingProjectConversation = conversation;
        this.renderProjectPicker();
        this.projectPickerModal.classList.add('active');
    }

    closeProjectPickerModal() {
        this.projectPickerModal.classList.remove('active');
    }

    renderProjectPicker() {
        this.projectPickerList.innerHTML = '';
        if (!this.projects.length) {
            const empty = document.createElement('p');
            empty.className = 'setting-hint';
            empty.textContent = 'No projects yet. Create one below.';
            this.projectPickerList.appendChild(empty);
            return;
        }
        const pending = this.pendingProjectConversation;
        if (pending?.projectId) {
            const none = document.createElement('button');
            none.type = 'button';
            none.className = 'project-picker-item';
            none.innerHTML = '<span class="project-picker-none-icon">—</span><span class="project-picker-item-copy"><strong>No project</strong><small>Keep in Recent Conversations only</small></span>';
            none.addEventListener('click', () => {
                this.removeConversationFromProject(pending.projectId, pending.id);
                this.pendingProjectConversation = null;
                this.closeProjectPickerModal();
                this.loadConversation(pending.id);
            });
            this.projectPickerList.appendChild(none);
        }
        this.projects.forEach(project => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'project-picker-item';
            item.innerHTML = `<svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" stroke-width="1.5"/></svg><span class="project-picker-item-copy"><strong></strong><small></small></span>`;
            item.querySelector('strong').textContent = project.name;
            item.querySelector('small').textContent = `${project.chats?.length || 0} chats · ${project.files?.length || 0} files`;
            item.addEventListener('click', () => this.addPendingConversationToProject(project));
            this.projectPickerList.appendChild(item);
        });
    }

    startCreateProjectForPendingChat() {
        this.closeProjectPickerModal();
        this.openCreateProjectModal();
    }

    addPendingConversationToProject(project) {
        const conversation = this.pendingProjectConversation;
        if (!conversation || !project) return;
        this.unlinkConversationFromProjects(conversation.id, project.id);
        const chat = {
            id: conversation.id,
            conversationId: conversation.id,
            title: conversation.title || 'Imported conversation',
            sourceConversationId: conversation.id,
            createdAt: new Date().toISOString()
        };
        project.chats ||= [];
        project.chats = project.chats.filter(item =>
            item.conversationId !== conversation.id
            && item.sourceConversationId !== conversation.id
            && item.id !== conversation.id
        );
        project.chats.unshift(chat);
        conversation.projectId = project.id;
        conversation.projectChatId = conversation.id;
        this.pendingProjectConversation = null;
        this.closeProjectPickerModal();
        this.saveConversations();
        this.saveProjects();
        this.currentProjectId = project.id;
        this.openProjectChat(chat.id);
    }

    unlinkConversationFromProjects(conversationId, exceptProjectId = null) {
        if (!conversationId) return;
        this.projects.forEach(project => {
            if (project.id === exceptProjectId || !Array.isArray(project.chats)) return;
            project.chats = project.chats.filter(chat => {
                const linkedId = chat.conversationId || chat.sourceConversationId || chat.id;
                return linkedId !== conversationId;
            });
        });
    }

    removeConversationFromProject(projectId, conversationId) {
        const project = this.projects.find(item => item.id === projectId);
        const conversation = this.conversations.find(item => item.id === conversationId);
        if (!project || !conversation) return;
        project.chats = (project.chats || []).filter(chat => {
            const linkedId = chat.conversationId || chat.sourceConversationId || chat.id;
            return linkedId !== conversationId;
        });
        if (conversation.projectId === projectId) {
            conversation.projectId = null;
            conversation.projectChatId = null;
        }
        this.saveProjects();
        this.saveConversations();
        this.loadProjectChats();
        this.loadConversations();
    }

    isConversationLocked() {
        return Boolean(this.getActiveConversation()?.messages?.length);
    }

    toggleConversationMenu() {
        if (!this.conversationMenu.hidden) {
            this.closeConversationMenu();
            return;
        }
        const conversation = this.getActiveConversation();
        if (!conversation) return;
        if (!conversation.selectedModel) conversation.selectedModel = this.model;
        this.conversationMenuTitle.textContent = conversation.generatedTitle || conversation.title || 'Conversation';
        this.conversationStar.querySelector('span').textContent = conversation.starred ? 'Unstar' : 'Star';
        this.conversationStar.classList.toggle('active', Boolean(conversation.starred));
        this.conversationThinking.classList.toggle('active', this.thinkingEnabled);
        this.conversationMenu.hidden = false;
        this.modelSelector.classList.add('conversation-locked');
    }

    closeConversationMenu() {
        this.conversationMenu.hidden = true;
    }

    changeCurrentConversationProject() {
        const conversation = this.getActiveConversation();
        if (!conversation) return;
        this.closeConversationMenu();
        this.pendingProjectConversation = conversation;
        this.renderProjectPicker();
        this.projectPickerModal.classList.add('active');
    }

    toggleCurrentConversationStar() {
        const conversation = this.getActiveConversation();
        if (!conversation) return;
        conversation.starred = !conversation.starred;
        this.saveActiveConversation();
        this.loadConversations();
        this.toggleConversationMenu();
        this.toggleConversationMenu();
    }

    renameCurrentConversation() {
        const conversation = this.getActiveConversation();
        if (!conversation) return;
        this.closeConversationMenu();
        this.openActionDialog({
            title: 'Rename conversation',
            value: conversation.generatedTitle || conversation.title || '',
            confirmLabel: 'Save',
            onConfirm: title => {
                conversation.title = title.slice(0, 120);
                conversation.generatedTitle = conversation.title;
                this.saveActiveConversation();
                this.loadConversations();
                if (this.projectChatMode) this.loadProjectChats();
            }
        });
    }

    deleteCurrentConversation() {
        const conversation = this.getActiveConversation();
        if (!conversation) return;
        this.closeConversationMenu();
        this.openActionDialog({
            title: 'Delete conversation?',
            message: `“${conversation.generatedTitle || conversation.title || 'This conversation'}” will be permanently removed.`,
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: () => {
                this.unlinkConversationFromProjects(conversation.id);
                this.conversations = this.conversations.filter(item => item.id !== conversation.id);
                this.saveProjects(); this.saveConversations();
                this.loadConversations(); this.createNewConversation();
            }
        });
    }

    setThinkingEnabled(active) {
        this.thinkingEnabled = Boolean(active);
        localStorage.setItem('claude_thinking_enabled', String(this.thinkingEnabled));
        this.thinkingBtn.classList.toggle('active', this.thinkingEnabled);
        this.thinkingBtn.setAttribute('aria-pressed', String(this.thinkingEnabled));
        this.thinkingBtn.setAttribute('aria-label', this.thinkingEnabled ? 'Disable extended thinking' : 'Enable extended thinking');
        this.conversationThinking?.classList.toggle('active', this.thinkingEnabled);
    }

    openActionDialog({ title, message = '', value = null, confirmLabel = 'Confirm', danger = false, onConfirm }) {
        this.actionDialogTitle.textContent = title;
        this.actionDialogMessage.textContent = message;
        this.actionDialogInput.hidden = value === null;
        this.actionDialogInput.value = value ?? '';
        this.actionDialogConfirm.textContent = confirmLabel;
        this.actionDialogConfirm.classList.toggle('danger-confirm', danger);
        this.actionDialogHandler = onConfirm;
        this.actionDialog.classList.add('active');
        if (value !== null) window.setTimeout(() => this.actionDialogInput.select(), 50);
    }

    closeActionDialog() {
        this.actionDialog.classList.remove('active');
        this.actionDialogHandler = null;
    }

    confirmActionDialog() {
        const handler = this.actionDialogHandler;
        const value = this.actionDialogInput.hidden ? null : this.actionDialogInput.value.trim();
        if (!this.actionDialogInput.hidden && !value) return;
        this.closeActionDialog();
        if (handler) handler(value);
    }

    syncProjectActionMenu() {
        const project = this.projects.find(item => item.id === this.currentProjectId);
        if (!project) return;
        this.projectStarAction.textContent = project.starred ? 'Unstar project' : 'Star project';
        this.starBtn.classList.toggle('active', Boolean(project.starred));
    }

    toggleCurrentProjectStar() {
        const project = this.projects.find(item => item.id === this.currentProjectId);
        if (!project) return;
        project.starred = !project.starred;
        this.saveProjects();
        this.syncProjectActionMenu();
        this.projectActionMenu.hidden = true;
    }

    renameCurrentProject() {
        const project = this.projects.find(item => item.id === this.currentProjectId);
        if (!project) return;
        this.projectActionMenu.hidden = true;
        this.openActionDialog({
            title: 'Rename project',
            value: project.name,
            confirmLabel: 'Save',
            onConfirm: value => {
                project.name = value.slice(0, 120);
                this.saveProjects();
                this.projectTitle.textContent = project.name;
                this.renderContextPills();
                this.loadProjects();
            }
        });
    }

    deleteCurrentProject() {
        const project = this.projects.find(item => item.id === this.currentProjectId);
        if (!project) return;
        this.projectActionMenu.hidden = true;
        this.openActionDialog({
            title: 'Delete project?',
            message: 'The project container will be deleted. Its conversations will remain in Recent Conversations.',
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: () => {
                (project.chats || []).forEach(chat => {
                    const id = chat.conversationId || chat.sourceConversationId || chat.id;
                    const conversation = this.conversations.find(item => item.id === id);
                    if (conversation?.projectId === project.id) {
                        conversation.projectId = null;
                        conversation.projectChatId = null;
                    }
                });
                this.projects = this.projects.filter(item => item.id !== project.id);
                this.currentProjectId = null;
                this.saveProjects();
                this.saveConversations();
                this.loadConversations();
                this.createNewConversation();
            }
        });
    }

    exportLocalBackup() {
        const data = {
            format: 'claude-local-backup',
            version: 1,
            exportedAt: new Date().toISOString(),
            conversations: this.conversations,
            projects: this.projects,
            artifacts: this.artifacts,
            preferences: {
                provider: this.provider,
                customBaseUrl: this.customBaseUrl,
                customModel: this.customModel,
                model: this.model,
                chatStyle: this.chatStyle,
                toolAccess: this.toolAccess,
                thinkingEnabled: this.thinkingEnabled
            }
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `claude-local-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    async importLocalBackup(file) {
        if (!file) return;
        this.backupImportInput.value = '';
        let data;
        try { data = JSON.parse(await file.text()); } catch { alert('This backup file is not valid JSON.'); return; }
        if (data?.format !== 'claude-local-backup' || !Array.isArray(data.conversations) || !Array.isArray(data.projects) || !Array.isArray(data.artifacts)) {
            alert('This is not a valid Claude local backup.');
            return;
        }
        this.openActionDialog({
            title: 'Restore backup?',
            message: 'Current conversations, projects, and Artifacts will be replaced by the backup. Your API key will not be changed.',
            confirmLabel: 'Restore',
            danger: true,
            onConfirm: async () => {
                const existingArtifacts = await fetch('/api/artifacts')
                    .then(response => response.ok ? response.json() : { artifacts: [] })
                    .then(result => result.artifacts || [])
                    .catch(() => []);
                await Promise.all(existingArtifacts.map(artifact =>
                    fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}`, { method: 'DELETE' })
                ));
                this.conversations = data.conversations;
                this.projects = data.projects;
                this.artifacts = data.artifacts;
                this.saveConversations(); this.saveProjects(); this.saveArtifacts();
                for (const artifact of this.artifacts) {
                    await fetch('/api/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(artifact) });
                }
                const prefs = data.preferences || {};
                if (prefs.model) localStorage.setItem('claude_model', prefs.model);
                if (prefs.chatStyle) localStorage.setItem('claude_chat_style', prefs.chatStyle);
                if (prefs.toolAccess) localStorage.setItem('claude_tool_access', prefs.toolAccess);
                if (typeof prefs.thinkingEnabled === 'boolean') localStorage.setItem('claude_thinking_enabled', String(prefs.thinkingEnabled));
                window.location.reload();
            }
        });
    }

    toggleSidebar() {
        this.setSidebarOpen(!this.sidebar.classList.contains('open'));
    }

    setSidebarOpen(open) {
        this.sidebar.classList.toggle('open', Boolean(open));
        this.sidebarDismiss.hidden = !open;
    }

    switchTab(tab) {
        this.currentTab = tab;
        this.navItems.forEach(item => {
            if (item.dataset.tab === tab) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        if (tab === 'chats') {
            this.loadConversations();
        } else if (tab === 'projects') {
            this.loadProjects();
            this.setSidebarOpen(false);

            if (this.projects.length > 0) {
                this.openProject(this.projects[0].id);
            } else {
                this.openCreateProjectModal();
            }
        } else if (tab === 'artifacts') {
            this.setSidebarOpen(false);
            this.openArtifacts();
        } else if (tab === 'dispatch') {
            // Keep the reference navigation visible while the local build has
            // no Dispatch backend yet. Leave the active chat and its history
            // untouched instead of presenting a misleading empty workspace.
            this.setSidebarOpen(false);
        } else {
            console.log(`Switched to ${tab} tab (functionality pending)`);
        }
    }

    loadProjects() {
        this.chatHistory.innerHTML = '';

        if (this.projects.length === 0) {
            this.chatHistory.innerHTML = '<p style="color: var(--text-secondary); padding: 12px;">No projects yet</p>';
            return;
        }

        this.projects.forEach(project => {
            const item = document.createElement('div');
            item.className = 'chat-history-item';
            item.textContent = project.name;
            item.addEventListener('click', () => {
                this.openProject(project.id);
                this.toggleSidebar();
            });
            this.chatHistory.appendChild(item);
        });
    }

    openAddModal() {
        this.syncAddSettingsLabels();
        this.addModal.classList.add('active');
    }

    closeAddModalHandler() {
        this.addModal.classList.remove('active');
    }

    closeSettingsModal() {
        this.settingsModal.classList.remove('active');
    }

    openSettingsModal() {
        this.providerSelect.value = this.provider;
        this.apiKeyInput.value = this.apiKey;
        this.customBaseUrlInput.value = this.customBaseUrl;
        this.customModelInput.value = this.customModel;
        this.modelSelect.value = this.model;
        this.setConnectionStatus('');
        this.settingsModal.classList.add('active');
    }

    saveSettingsData() {
        this.provider = this.providerSelect.value;
        this.apiKey = this.apiKeyInput.value.trim();
        this.customBaseUrl = this.customBaseUrlInput.value.trim();
        this.customModel = this.customModelInput.value.trim();
        this.model = this.modelSelect.value;

        if (this.provider === 'custom' && !this.apiKey) this.provider = 'mock';

        localStorage.setItem('claude_provider', this.provider);
        localStorage.setItem('claude_api_key', this.apiKey);
        localStorage.setItem('claude_custom_base_url', this.customBaseUrl);
        localStorage.setItem('claude_custom_model', this.customModel);
        localStorage.setItem('claude_model', this.model);

        this.applyModelSelection(this.model);
        this.closeSettingsModal();
    }

    setConnectionStatus(message, tone = '') {
        if (!this.connectionStatus) return;
        this.connectionStatus.textContent = message;
        this.connectionStatus.className = `connection-status ${tone}`.trim();
    }

    async testCustomConnection() {
        const provider = this.providerSelect.value;
        const baseUrl = this.customBaseUrlInput.value.trim();
        const apiKey = this.apiKeyInput.value.trim();
        const model = this.customModelInput.value.trim();
        if (provider !== 'custom') {
            this.setConnectionStatus('先把连接方式选成 Custom API relay。', 'warn');
            return;
        }
        if (!baseUrl || !apiKey || !model) {
            this.setConnectionStatus('Base URL、API Key、模型名都要填。', 'warn');
            return;
        }
        this.testConnectionBtn.disabled = true;
        this.setConnectionStatus('正在测试...', '');
        try {
            const response = await fetch('/api/test-custom-connection', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baseUrl, apiKey, model })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
            this.setConnectionStatus('连接成功，可以保存后发消息。', 'ok');
        } catch (error) {
            this.setConnectionStatus(`连接失败：${error.message}`, 'error');
        } finally {
            this.testConnectionBtn.disabled = false;
        }
    }

    applyModelSelection(model) {
        if (!['claude-opus-4-6', 'claude-opus-4-5', 'claude-sonnet-4-5'].includes(model)) return;
        this.model = model;
        localStorage.setItem('claude_model', model);
        this.currentModelSpan.textContent = this.getCurrentModelName();
        this.modelSelect.value = model;
        this.modelOptions.forEach(option => {
            option.classList.toggle('active', option.dataset.model === model);
        });
        this.modelMenu.style.display = 'none';
    }

    switchView(view) {
        this.currentView = view;
        this.artifactView.style.display = 'none';
        if (view === 'chat') {
            this.chatMain.style.display = 'flex';
            this.projectView.style.display = 'none';
            if (!this.projectChatMode) this.currentProjectId = null;
        } else if (view === 'project') {
            this.chatMain.style.display = 'none';
            this.projectView.style.display = 'flex';
        } else if (view === 'artifact') {
            this.chatMain.style.display = 'none';
            this.projectView.style.display = 'none';
            this.artifactView.style.display = 'flex';
        }
    }

    openCreateProjectModal() {
        this.projectNameInput.value = '';
        this.createProjectModal.classList.add('active');
    }

    closeCreateProjectModal() {
        this.createProjectModal.classList.remove('active');
    }

    createProject() {
        const name = this.projectNameInput.value.trim();
        if (!name) {
            alert('Please enter a project name');
            return;
        }

        const project = {
            id: Date.now().toString(),
            name: name,
            instructions: '',
            files: [],
            chats: [],
            createdAt: new Date().toISOString()
        };

        this.projects.unshift(project);
        this.saveProjects();
        this.closeCreateProjectModal();
        if (this.pendingProjectConversation) {
            this.addPendingConversationToProject(project);
            return;
        }
        this.openProject(project.id);
        this.switchTab('projects');
    }

    getProjectConversationRefs(project) {
        const chats = Array.isArray(project?.chats) ? project.chats : [];
        return chats.map(chat => {
            const conversationId = chat.conversationId || chat.sourceConversationId || chat.id;
            let conversation = this.conversations.find(item => item.id === conversationId);
            if (!conversation && Array.isArray(chat.messages)) {
                conversation = {
                    id: conversationId || chat.id || Date.now().toString(),
                    title: chat.title || 'Imported conversation',
                    messages: chat.messages || [],
                    sessionId: chat.sessionId || null,
                    contextVersion: chat.contextVersion || 0,
                    projectId: project.id,
                    projectChatId: chat.id,
                    artifactId: chat.artifactId || null,
                    artifactIds: Array.isArray(chat.artifactIds) ? chat.artifactIds : [],
                    createdAt: chat.createdAt || new Date().toISOString()
                };
                this.conversations.unshift(conversation);
                chat.conversationId = conversation.id;
                this.saveConversations();
                this.saveProjects();
            }
            return {
                chat,
                conversation,
                id: conversation?.id || chat.id,
                title: conversation?.title || chat.title || 'Imported conversation',
                messages: conversation?.messages || chat.messages || [],
                createdAt: conversation?.createdAt || chat.createdAt
            };
        });
    }

    openProject(projectId) {
        this.currentProjectId = projectId;
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        this.projectTitle.textContent = project.name;
        this.syncProjectActionMenu();
        this.switchView('project');
        this.updateProjectFiles();
        this.loadProjectChats();
        this.showProjectChats();
    }

    showProjectChats() {
        this.projectChatsWorkspace.classList.add('active');
        this.openArtifactsFromProject.classList.remove('active');
        this.projectChats.hidden = false;
        this.projectArtifactsList.hidden = true;
        this.newProjectChat.hidden = false;
    }

    async showProjectArtifacts() {
        this.projectChatsWorkspace.classList.remove('active');
        this.openArtifactsFromProject.classList.add('active');
        this.projectChats.hidden = true;
        this.projectArtifactsList.hidden = false;
        this.newProjectChat.hidden = true;
        this.renderProjectArtifacts();
        try {
            await this.syncArtifactsFromServer();
            this.renderProjectArtifacts();
        } catch (error) {
            console.warn('Artifact sync unavailable; showing local artifacts', error);
        }
    }

    renderProjectArtifacts() {
        const artifacts = this.artifacts;
        this.projectArtifactsList.innerHTML = '';
        if (!artifacts.length) {
            this.projectArtifactsList.innerHTML = '<p class="project-artifacts-empty">No artifacts yet</p>';
            return;
        }
        artifacts.forEach(artifact => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'project-artifact-item';
            item.innerHTML = `
                <span class="project-artifact-icon">${this.getArtifactDocumentIcon()}</span>
                <span class="project-artifact-copy">
                    <strong>${this.escapeHtml(artifact.title)}</strong>
                    <small>${this.escapeHtml(this.getArtifactListMeta(artifact))}</small>
                </span>
                <svg class="project-artifact-arrow" width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            item.addEventListener('click', () => {
                this.currentArtifactId = artifact.id;
                this.switchView('artifact');
                this.renderArtifacts();
                this.openArtifact(artifact.id);
            });
            this.projectArtifactsList.appendChild(item);
        });
    }

    loadProjectChats() {
        const project = this.projects.find(p => p.id === this.currentProjectId);
        if (!project) return;

        this.projectChats.innerHTML = '';

        const projectConversations = this.getProjectConversationRefs(project);
        if (projectConversations.length === 0) {
            this.projectChats.innerHTML = '<p style="color: var(--text-secondary); padding: 20px; text-align: center;">No chats in this project yet</p>';
            return;
        }

        projectConversations.forEach(({ chat, conversation, id: conversationId, title: chatTitle, createdAt }) => {
            const item = document.createElement('div');
            item.className = 'project-chat-item';

            const info = document.createElement('div');
            info.className = 'project-chat-info';

            const title = document.createElement('div');
            title.className = 'project-chat-title';
            title.textContent = chatTitle;

            const time = document.createElement('div');
            time.className = 'project-chat-time';
            time.textContent = this.formatTime(createdAt);

            info.appendChild(title);
            info.appendChild(time);

            const arrow = document.createElement('div');
            arrow.className = 'project-chat-arrow';
            arrow.innerHTML = '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M7 4l6 6-6 6"/></svg>';

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'project-chat-remove';
            remove.setAttribute('aria-label', 'Remove from project');
            remove.title = 'Remove from project';
            remove.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"><path d="M5 10h10" stroke-width="1.8" stroke-linecap="round"/></svg>';
            remove.addEventListener('click', event => {
                event.stopPropagation();
                this.removeConversationFromProject(project.id, conversation?.id || conversationId);
            });

            item.appendChild(info);
            item.appendChild(remove);
            item.appendChild(arrow);

            item.addEventListener('click', () => {
                this.openProjectChat(chat.id);
            });

            this.projectChats.appendChild(item);
        });
    }

    formatTime(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;

        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        const weeks = Math.floor(diff / 604800000);
        const months = Math.floor(diff / 2592000000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
        if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
        return `${months} month${months > 1 ? 's' : ''} ago`;
    }

    createProjectChat() {
        const project = this.projects.find(p => p.id === this.currentProjectId);
        if (!project) return;

        this.currentProjectChatId = null;
        this.projectChatMode = true;
        this.currentConversationId = null;
        this.prepareProjectChatHeader(project.name);
        this.messagesContainer.innerHTML = this.getWelcomeMarkup(`Chat in ${project.name}`);
        this.messageInput.value = '';
        this.updateChatPlaceholder(null);
        this.currentArtifactId = null;
        this.renderContextPills();
        this.syncSendButtonState();
        this.switchView('chat');
        this.messageInput.focus();
    }

    materializeProjectConversation(firstMessage = '') {
        const project = this.projects.find(item => item.id === this.currentProjectId);
        if (!project) return null;
        const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const conversation = {
            id,
            title: firstMessage.slice(0, 30) || 'New conversation',
            messages: [],
            projectId: project.id,
            projectChatId: id,
            artifactId: null,
            artifactIds: [],
            selectedModel: this.model,
            createdAt: new Date().toISOString()
        };
        this.conversations.unshift(conversation);
        project.chats ||= [];
        project.chats.unshift({
            id,
            conversationId: id,
            title: conversation.title,
            createdAt: conversation.createdAt
        });
        this.currentProjectChatId = id;
        this.currentConversationId = id;
        this.saveConversations();
        this.saveProjects();
        return conversation;
    }

    openProjectChat(chatId) {
        const project = this.projects.find(p => p.id === this.currentProjectId);
        const ref = this.getProjectConversationRefs(project).find(item => item.chat.id === chatId || item.id === chatId);
        if (!project || !ref) return;

        this.currentProjectChatId = ref.chat.id;
        this.projectChatMode = true;
        this.currentConversationId = ref.conversation?.id || null;
        if (ref.conversation && !ref.conversation.selectedModel) ref.conversation.selectedModel = this.model;
        this.prepareProjectChatHeader(project.name);
        this.updateChatPlaceholder(ref.conversation || { messages: ref.messages });
        this.messageInput.value = '';
        this.messagesContainer.innerHTML = '';

        if (ref.messages.length === 0) {
            this.messagesContainer.innerHTML = this.getWelcomeMarkup(`Chat in ${project.name}`);
        } else {
            this.renderStoredMessages(ref.messages);
        }

        this.syncCurrentArtifactFromConversation();
        this.syncConversationHeader();
        this.renderContextPills();
        this.syncSendButtonState();
        this.switchView('chat');
        this.scrollConversationToBottom(false);
    }

    prepareProjectChatHeader(projectName) {
        this.currentModelSpan.textContent = this.getCurrentModelName();
        this.menuBtn.dataset.originalIcon ||= this.menuBtn.innerHTML;
        this.menuBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15 18l-6-6 6-6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        this.menuBtn.setAttribute('aria-label', 'Back to project');
        this.renderContextPills();
    }

    exitProjectChat() {
        const projectId = this.currentProjectId;
        this.projectChatMode = false;
        this.currentProjectChatId = null;
        this.updateChatPlaceholder();
        if (this.menuBtn.dataset.originalIcon) this.menuBtn.innerHTML = this.menuBtn.dataset.originalIcon;
        this.menuBtn.setAttribute('aria-label', 'Open sidebar');
        this.currentModelSpan.textContent = this.getCurrentModelName();
        this.renderContextPills();
        if (projectId) this.openProject(projectId);
        else this.switchView('chat');
    }

    getCurrentModelName() {
        if (this.provider === 'mock') return 'Mock Claude';
        const names = {
            'claude-opus-4-6': 'Opus 4.6',
            'claude-opus-4-5': 'Opus 4.5',
            'claude-sonnet-4-5': 'Sonnet 4.5'
        };
        return names[this.model] || 'Claude';
    }

    getConversationModelName(conversation = this.getActiveConversation()) {
        if (!conversation) return this.getCurrentModelName();
        const names = {
            'claude-opus-4-6': 'Opus 4.6',
            'claude-opus-4-5': 'Opus 4.5',
            'claude-sonnet-4-5': 'Sonnet 4.5'
        };
        return names[conversation.selectedModel] || this.getCurrentModelName();
    }

    syncConversationHeader() {
        const locked = this.isConversationLocked();
        this.currentModelSpan.textContent = locked ? this.getConversationModelName() : this.getCurrentModelName();
        this.modelSelector.classList.toggle('conversation-locked', locked);
        this.modelSelector.setAttribute('aria-label', locked ? 'Open conversation menu' : 'Choose model');
        if (!locked) this.closeConversationMenu();
    }

    openInstructionsModal() {
        const project = this.projects.find(p => p.id === this.currentProjectId);
        if (!project) return;

        this.instructionsText.value = project.instructions || '';
        this.instructionsModal.style.display = 'flex';
    }

    closeInstructionsModal() {
        this.instructionsModal.style.display = 'none';
    }

    saveInstructionsData() {
        const project = this.projects.find(p => p.id === this.currentProjectId);
        if (!project) return;

        project.instructions = this.instructionsText.value.trim();
        this.saveProjects();
        this.closeInstructionsModal();
    }

    openFilesDrawer() {
        this.filesDrawerOverlay.style.display = 'block';
        this.filesDrawer.style.display = 'flex';
        this.updateProjectFiles();
    }

    closeFilesDrawerHandler() {
        this.filesDrawerOverlay.style.display = 'none';
        this.filesDrawer.style.display = 'none';
    }

    updateProjectFiles() {
        const project = this.projects.find(p => p.id === this.currentProjectId);
        if (!project) return;

        this.filesCount.textContent = `${project.files.length} file${project.files.length !== 1 ? 's' : ''}`;

        const totalSize = project.files.reduce((sum, file) => sum + file.size, 0);
        const capacity = 100 * 1024 * 1024;
        const percent = Math.min(Math.round((totalSize / capacity) * 100), 100);

        this.capacityFill.style.width = `${percent}%`;
        this.capacityText.textContent = `${percent}% of project capacity used`;

        this.filesGrid.innerHTML = '';

        if (project.files.length === 0) {
            this.filesGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 20px;">No files yet</p>';
            return;
        }

        project.files.forEach(file => {
            const card = document.createElement('div');
            card.className = 'file-card';

            const type = document.createElement('div');
            type.className = 'file-type';
            type.textContent = this.getFileType(file.name);

            const name = document.createElement('div');
            name.className = 'file-name';
            name.textContent = file.name;

            const meta = document.createElement('div');
            meta.className = 'file-meta';
            const kind = document.createElement('span');
            kind.className = `file-badge ${file.vision ? 'image' : 'file'}`;
            kind.textContent = file.vision ? 'Image' : this.getFileKind(file);
            const status = document.createElement('span');
            const statusText = this.getFileStatusLabel(file);
            status.className = `file-badge ${statusText === 'In context' ? 'in-context' : 'on-request'}`;
            status.textContent = statusText;
            meta.appendChild(kind);
            meta.appendChild(status);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'file-delete';
            deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4L4 12" stroke="white" stroke-width="2"/></svg>';
            deleteBtn.addEventListener('click', () => this.deleteFile(file.id));

            card.appendChild(type);
            card.appendChild(name);
            card.appendChild(meta);
            card.appendChild(deleteBtn);
            this.filesGrid.appendChild(card);
        });
    }

    getFileKind(file) {
        if (file.readable) return 'Text';
        if (file.relativePath) return 'File';
        return 'Listed';
    }

    getFileStatusLabel(file) {
        if (file.readable) return 'In context';
        if (!file.vision && file.relativePath && this.isTextLikeName(file.name, file.type)) return 'Bridge read';
        return 'On request';
    }

    isTextLikeName(name, type = '') {
        const fakeFile = { name: name || '', type: type || '' };
        return this.isTextLikeFile(fakeFile);
    }

    getFileType(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        const typeMap = {
            'txt': 'TXT',
            'md': 'MD',
            'pdf': 'PDF',
            'doc': 'DOC',
            'docx': 'DOC',
            'xls': 'XLS',
            'xlsx': 'XLS',
            'ppt': 'PPT',
            'pptx': 'PPT',
            'jpg': 'JPG',
            'jpeg': 'JPG',
            'png': 'PNG',
            'gif': 'GIF',
            'zip': 'ZIP',
            'rar': 'RAR'
        };
        return typeMap[ext] || ext.toUpperCase();
    }

    handleAddFiles() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = (e) => {
            const files = Array.from(e.target.files);
            this.addFiles(files);
        };
        input.click();
    }

    isTextLikeFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        return file.type.startsWith('text/')
            || [
                'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl',
                'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
                'py', 'rb', 'php', 'java', 'c', 'h', 'cpp', 'hpp', 'cs',
                'go', 'rs', 'swift', 'kt', 'kts', 'sh', 'bat', 'cmd', 'ps1',
                'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'sql', 'log'
            ].includes(ext);
    }

    isImageFile(file) {
        return file.type.startsWith('image/')
            || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(file.name.split('.').pop().toLowerCase());
    }

    readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Could not read file'));
            reader.readAsDataURL(file);
        });
    }

    async uploadProjectBinaryFile(file) {
        if (file.size > 25 * 1024 * 1024) {
            throw new Error(`${file.name} is larger than the 25MB per-file limit`);
        }
        const dataUrl = await this.readFileAsDataUrl(file);
        const response = await fetch('/api/project-files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: file.name,
                type: file.type || 'application/octet-stream',
                dataUrl
            })
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || `Could not upload ${file.name}`);
        }
        const { file: storedFile } = await response.json();
        return storedFile;
    }

    readProjectFile(file) {
        return new Promise(resolve => {
            if (!this.isTextLikeFile(file)) {
                resolve({ readable: false, content: '', inline: false });
                return;
            }
            if (file.size > 100 * 1024) {
                resolve({ readable: false, content: '', inline: false, skippedReason: 'File is larger than 100KB; ask to read it by filename when needed' });
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve({
                readable: true,
                inline: true,
                content: String(reader.result || '')
            });
            reader.onerror = () => resolve({ readable: false, inline: false, content: '', skippedReason: 'Could not read file' });
            reader.readAsText(file);
        });
    }

    async addFiles(fileObjects) {
        const project = this.projects.find(p => p.id === this.currentProjectId);
        if (!project) return;

        let files = [];
        try {
            files = await Promise.all(fileObjects.map(async fileObj => {
                if (this.isImageFile(fileObj)) {
                    const storedFile = await this.uploadProjectBinaryFile(fileObj);
                    return {
                        id: storedFile.id,
                        name: storedFile.name,
                        size: storedFile.size,
                        type: storedFile.type,
                        addedAt: storedFile.storedAt || new Date().toISOString(),
                        readable: false,
                        vision: true,
                        relativePath: storedFile.relativePath,
                        content: '',
                        skippedReason: 'Available for visual reading'
                    };
                }
                const fileContent = await this.readProjectFile(fileObj);
                const storedFile = await this.uploadProjectBinaryFile(fileObj);
                const file = {
                    id: storedFile.id,
                    name: storedFile.name,
                    size: storedFile.size,
                    type: storedFile.type,
                    addedAt: new Date().toISOString(),
                    readable: fileContent.readable,
                    relativePath: storedFile.relativePath,
                    content: fileContent.content,
                    skippedReason: fileContent.skippedReason || ''
                };
                return file;
            }));
        } catch (error) {
            alert(error.message || 'Could not add project file');
            return;
        }

        project.files.push(...files);

        this.saveProjects();
        this.updateProjectFiles();
    }

    buildProjectContext() {
        if (!this.projectChatMode || !this.currentProjectId) return null;
        const project = this.projects.find(p => p.id === this.currentProjectId);
        if (!project) return null;
        return {
            id: project.id,
            name: project.name,
            instructions: project.instructions || '',
            files: (project.files || []).map(file => ({
                name: file.name,
                size: file.size,
                type: file.type || '',
                readable: Boolean(file.readable),
                vision: Boolean(file.vision),
                relativePath: file.relativePath || '',
                content: file.readable ? String(file.content || '').slice(0, 80000) : '',
                skippedReason: file.skippedReason || ''
            }))
        };
    }

    async deleteFile(fileId) {
        const project = this.projects.find(p => p.id === this.currentProjectId);
        if (!project) return;

        project.files = project.files.filter(f => f.id !== fileId);
        this.saveProjects();
        this.updateProjectFiles();
        try {
            await fetch(`/api/project-files?id=${encodeURIComponent(fileId)}`, { method: 'DELETE' });
        } catch (error) {
            console.warn('Could not remove stored project file', error);
        }
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        const attachments = this.pendingAttachments.slice();
        if (!message && attachments.length === 0) return;
        if (window.location.protocol === 'file:') {
            alert('发送消息需要本地服务。请双击 start-app.cmd，并在自动打开的网页中使用。');
            return;
        }

        const displayMessage = [
            message,
            attachments.length
                ? attachments.map(file => `[Attached: ${file.name}]`).join('\n')
                : ''
        ].filter(Boolean).join('\n\n');

        this.ensureActiveConversation(message || attachments[0]?.name || 'Attachment');

        const editingConversation = this.getActiveConversation();
        if (Number.isInteger(this.editingMessageIndex) && editingConversation) {
            editingConversation.messages = editingConversation.messages.slice(0, this.editingMessageIndex);
            editingConversation.sessionId = null;
            editingConversation.contextVersion = this.contextVersion;
            this.editingMessageIndex = null;
            this.saveActiveConversation();
            this.messagesContainer.innerHTML = '';
            const lastAssistantIndex = editingConversation.messages.findLastIndex(item => item?.role === 'assistant');
            this.renderStoredMessages(editingConversation.messages);
        }

        this.addMessage('user', displayMessage);
        this.syncConversationHeader();
        this.messageInput.value = '';
        this.syncSendButtonState();
        this.pendingAttachments = [];
        this.renderPendingAttachments();
        this.messageInput.disabled = true;

        const conversation = this.getActiveConversation();
        this.messagesContainer.querySelectorAll('.streaming-activity').forEach(node => node.remove());
        const assistantMessageDiv = this.addMessage('assistant', '');
        const contentDiv = assistantMessageDiv.querySelector('.message-content');
        const activity = this.createStreamingActivity(assistantMessageDiv, 'generating');
        const thinkingState = { block: null, body: null, text: '' };
        const toolState = new Map();
        const suppressedToolIds = new Set();
        const projectContext = this.buildProjectContext();
        const knownProjectFileNames = new Set(
            (projectContext?.files || [])
                .filter(file => file.readable && String(file.content || '').trim())
                .map(file => this.normalizeProjectFileName(file.name))
        );
        const allProjectFilesInline = Boolean(
            projectContext?.files?.length
            && projectContext.files.every(file => file.readable && String(file.content || '').trim())
        );
        let fullResponse = '';
        let streamPendingText = '';
        let renderedStreamText = '';

        const appendStreamText = text => {
            fullResponse += text;
            streamPendingText += text;
            const cut = this.findStreamingFlushCut(streamPendingText);
            if (cut <= 0) return;
            renderedStreamText += streamPendingText.slice(0, cut);
            streamPendingText = streamPendingText.slice(cut);
            contentDiv.textContent = this.renderStreamingResponse(renderedStreamText);
        };

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message || 'The user attached file(s) in the local UI, but attachment reading is not connected for ordinary chats yet. Explain that you cannot inspect the attachment contents in this chat mode yet.',
                    model: this.model,
                    provider: this.provider,
                    customBaseUrl: this.customBaseUrl,
                    customApiKey: this.apiKey,
                    customModel: this.customModel,
                    sessionId: conversation.contextVersion === this.contextVersion
                        ? (conversation.sessionId || null)
                        : null,
                    history: conversation.messages.slice(-40).map(item => ({
                        role: item.role,
                        content: item.content || ''
                    })),
                    thinkingEnabled: this.thinkingBtn.classList.contains('active'),
                    researchEnabled: this.getAddToggleValue('Research'),
                    webSearchEnabled: this.getAddToggleValue('Web search'),
                    style: this.chatStyle,
                    toolAccess: this.toolAccess,
                    requestConversationTitle: conversation.messages.length === 1 && !conversation.generatedTitle,
                    projectId: this.projectChatMode ? this.currentProjectId : null,
                    project: projectContext,
                    attachments
                })
            });

            if (!response.ok) {
                throw new Error(`Local bridge returned ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.trim()) continue;
                    this.handleBridgeEvent(
                        JSON.parse(line),
                        { conversation, contentDiv, thinkingState, toolState, activity, suppressedToolIds, knownProjectFileNames, allProjectFilesInline },
                        appendStreamText
                    );
                }
                this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            }

            if (buffer.trim()) {
                this.handleBridgeEvent(
                    JSON.parse(buffer),
                    { conversation, contentDiv, thinkingState, toolState, activity, suppressedToolIds, knownProjectFileNames, allProjectFilesInline },
                    appendStreamText
                );
            }

            const titleResult = this.extractConversationTitle(fullResponse);
            fullResponse = titleResult.cleanText;
            if (titleResult.title) {
                conversation.generatedTitle = titleResult.title;
                conversation.title = titleResult.title;
            }
            const artifactResult = this.extractArtifacts(fullResponse);
            await Promise.all(
                artifactResult.artifacts.map(artifact => this.createArtifactFromModel(artifact))
            );
            fullResponse = artifactResult.cleanText;
            contentDiv.textContent = fullResponse;
            this.setStreamingActivity(activity, 'complete');

            conversation.messages.push({
                role: 'assistant',
                content: fullResponse,
                blocks: [
                    ...(thinkingState.block ? [{
                        type: 'thought',
                        content: thinkingState.text,
                        summary: this.getThoughtSummary(thinkingState.text)
                    }] : []),
                    ...Array.from(toolState.values()).map(tool => ({
                        type: 'tool',
                        id: tool.id,
                        title: tool.title,
                        summary: tool.summary,
                        steps: tool.steps
                    }))
                ]
            });

            if (conversation.messages.length === 2) {
                const titleSource = message || attachments[0]?.name || 'Attachment';
                if (!conversation.generatedTitle) {
                    conversation.title = titleSource.slice(0, 30) + (titleSource.length > 30 ? '...' : '');
                }
                this.saveActiveConversation();
                this.loadConversations();
                if (this.projectChatMode) this.loadProjectChats();
            }

            this.saveActiveConversation();
            this.addMessageActions(assistantMessageDiv);

        } catch (error) {
            this.setStreamingActivity(activity, 'error');
            contentDiv.textContent = 'Error: ' + error.message;
            if (attachments.length && this.pendingAttachments.length === 0) {
                this.pendingAttachments = attachments;
                this.renderPendingAttachments();
            }
            console.error('Error:', error);
        } finally {
            this.messageInput.disabled = false;
            this.messageInput.focus();
        }
    }

    handleBridgeEvent(event, state, appendText) {
        if (event.type === 'session') {
            state.conversation.sessionId = event.sessionId;
            state.conversation.model = event.model;
            state.conversation.contextVersion = this.contextVersion;
            this.saveActiveConversation();
            return;
        }

        if (event.type === 'session_reset') {
            state.conversation.sessionId = null;
            state.conversation.contextVersion = 0;
            this.saveActiveConversation();
            return;
        }

        if (event.type === 'text_delta') {
            this.setStreamingActivity(state.activity, 'generating');
            appendText(event.text || '');
            return;
        }

        if (event.type === 'thinking_start') {
            this.ensureThinkingBlock(state);
            return;
        }

        if (event.type === 'thinking_delta') {
            this.ensureThinkingBlock(state);
            state.thinkingState.text += event.text || '';
            state.thinkingState.body.textContent = state.thinkingState.text;
            return;
        }

        if (event.type === 'thinking_delta_legacy') {
            if (!state.thinkingState.block) {
                state.thinkingState.block = this.createExpandableBlock({
                    kind: 'thought',
                    title: 'Thought process',
                    summary: 'Thinking…',
                    icon: '◔'
                });
                state.thinkingState.body = state.thinkingState.block.querySelector('.response-block-body');
                state.contentDiv.parentElement.before(state.thinkingState.block);
            }
            state.thinkingState.text += event.text || '';
            state.thinkingState.body.textContent = state.thinkingState.text;
            return;
        }

        if (event.type === 'tool_start') {
            this.setStreamingActivity(state.activity, 'generating');
            if (this.shouldHideKnownProjectTool(event, state)) {
                if (event.id) state.suppressedToolIds.add(event.id);
                return;
            }
            const title = event.name === 'Read' ? 'Reading file' : (event.name || 'Tool activity');
            const tool = {
                id: event.id,
                title,
                summary: event.summary || title,
                steps: [{
                    title,
                    summary: event.summary || this.describeToolInput(event.input) || title,
                    status: 'running'
                }]
            };
            tool.block = this.addToolBlock(tool);
            state.contentDiv.parentElement.before(tool.block);
            state.toolState.set(event.id || String(state.toolState.size), tool);
            return;
        }

        if (event.type === 'tool_result') {
            this.setStreamingActivity(state.activity, 'generating');
            if (event.id && state.suppressedToolIds.has(event.id)) return;
            const tool = state.toolState.get(event.id);
            if (!tool) return;
            tool.summary = event.summary || tool.summary || tool.title;
            if (tool.steps[0]) tool.steps[0].status = event.error ? 'error' : 'complete';
            tool.steps.push({
                title: event.error ? `${tool.title} failed` : `${tool.title} completed`,
                summary: event.summary || this.describeToolResult(event.content) ||
                    (event.error ? `${tool.title} failed` : `${tool.title} completed`),
                status: event.error ? 'error' : 'complete'
            });
            const replacement = this.addToolBlock(tool);
            tool.block.replaceWith(replacement);
            tool.block = replacement;
            return;
        }

        if (event.type === 'done') {
            this.setStreamingActivity(state.activity, 'complete');
            if (state.thinkingState.block) {
                state.thinkingState.block.querySelector('.response-block-summary').textContent =
                    this.getThoughtSummary(state.thinkingState.text);
            }
            return;
        }

        if (event.type === 'error') {
            throw new Error(event.message || event.reason || 'Claude request failed');
        }
    }

    ensureThinkingBlock(state) {
        if (state.thinkingState.block) return;
        state.thinkingState.block = this.createExpandableBlock({
            kind: 'thought',
            title: 'Thought process',
            summary: 'Thinking…',
            icon: '●'
        });
        state.thinkingState.body = state.thinkingState.block.querySelector('.response-block-body');
        state.thinkingState.body.textContent = 'Reasoning in progress…';
        state.contentDiv.parentElement.before(state.thinkingState.block);
    }

    createStreamingActivity(messageDiv, mode = 'static') {
        const activity = document.createElement('div');
        activity.className = `streaming-activity ${mode === 'generating' ? 'generating' : 'static'}`;
        activity.setAttribute('aria-hidden', 'true');
        const officialPath = 'm19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z';
        activity.innerHTML = `
            <svg class="streaming-activity-logo" viewBox="0 0 100 100" fill="currentColor" aria-hidden="true">
                <path d="${officialPath}"/>
            </svg>`;
        messageDiv.appendChild(activity);
        return activity;
    }

    setStreamingActivity(activity, mode = 'generating') {
        if (!activity) return;
        activity.className = `streaming-activity ${mode === 'generating' ? 'generating' : 'static'}`;
    }

    findStreamingFlushCut(text) {
        const value = String(text || '');
        if (!value) return 0;
        if (/[\r\n]|```/.test(value)) return value.length;
        const units = /[\u3400-\u9fff]|[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g;
        let match;
        let count = 0;
        let end = 0;
        while ((match = units.exec(value))) {
            count += 1;
            end = match.index + match[0].length;
            if (count >= 8) return end;
        }
        return 0;
    }

    normalizeProjectFileName(value) {
        return String(value || '')
            .replace(/\\/g, '/')
            .split('/')
            .pop()
            .toLowerCase()
            .trim();
    }

    shouldHideKnownProjectTool(event, state) {
        if (!state.allProjectFilesInline) return false;
        const name = String(event.name || '').toLowerCase();
        if (!/project knowledge|read project file|^read$/.test(name)) return false;
        const input = event.input && typeof event.input === 'object' ? event.input : {};
        const candidates = [];
        if (Array.isArray(input.files)) candidates.push(...input.files);
        ['path', 'file_path', 'filePath', 'name'].forEach(key => {
            if (input[key]) candidates.push(input[key]);
        });
        if (!candidates.length) return name.includes('project knowledge');
        return candidates.every(file => state.knownProjectFileNames.has(this.normalizeProjectFileName(file)));
    }

    describeToolInput(input) {
        if (!input || typeof input !== 'object') return '';
        if (Array.isArray(input.files)) {
            return input.files.map(file => String(file)).join(', ').slice(0, 240);
        }
        if (input.files || input.inline || input.listed) {
            const parts = [];
            if (input.files) parts.push(`${input.files} files`);
            if (input.inline) parts.push(`${input.inline} inline`);
            if (input.listed) parts.push(`${input.listed} listed`);
            return parts.join(', ');
        }
        const value = input.command || input.query || input.path || input.file_path || '';
        return String(value).slice(0, 180);
    }

    describeToolResult(content) {
        if (typeof content === 'string') return content.slice(0, 240);
        if (Array.isArray(content)) {
            return content.map(item => item.text || '').filter(Boolean).join(' ').slice(0, 240);
        }
        return '';
    }

    extractArtifacts(text) {
        const artifacts = [];
        const pattern = /<artifact\s+type="(html|markdown|text|code)"\s+title="([^"]+)">([\s\S]*?)<\/artifact>/gi;
        const cleanText = text.replace(pattern, (match, type, title, content, offset) => {
            const fenceCount = (text.slice(0, offset).match(/```/g) || []).length;
            if (fenceCount % 2 === 1) return match;
            artifacts.push({ type, title, content: content.trim() });
            return `\nCreated artifact: ${title}\n`;
        }).trim();
        return { cleanText, artifacts };
    }

    extractConversationTitle(text) {
        let title = '';
        const cleanText = String(text || '').replace(/<conversation_title>([\s\S]*?)<\/conversation_title>/gi, (match, value) => {
            if (!title) title = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 120);
            return '';
        }).trim();
        return { cleanText, title };
    }

    renderStreamingResponse(text) {
        let insideFence = false;
        return text.split('```').map((part, index) => {
            const prefix = index === 0 ? '' : '```';
            if (index > 0) insideFence = !insideFence;
            if (insideFence) return prefix + part;
            return prefix + part
                .replace(/<conversation_title>[\s\S]*?(?:<\/conversation_title>|$)/gi, '')
                .replace(/<artifact\s+type="(?:html|markdown|text|code)"\s+title="[^"]+">/gi, '')
                .replace(/<\/artifact>/gi, '');
        }).join('');
    }

    async createArtifactFromModel(data) {
        const draft = {
            id: Date.now().toString() + Math.random().toString(16).slice(2),
            title: data.title || 'Claude artifact',
            type: data.type || 'text',
            content: data.content || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const response = await fetch('/api/artifacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft)
        });
        if (!response.ok) throw new Error('Claude created an artifact, but the file could not be saved');
        const { artifact } = await response.json();
        this.artifacts.unshift(artifact);
        this.saveArtifacts();
        this.setScopedArtifactId(artifact.id);
        this.renderContextPills();
        return artifact;
    }

    renderContextPills() {
        const project = this.projectChatMode
            ? this.projects.find(item => item.id === this.currentProjectId)
            : null;
        this.syncCurrentArtifactFromConversation();
        const artifact = this.artifacts.find(item => item.id === this.currentArtifactId);
        this.projectContextPill.hidden = !project;
        if (project) {
            this.projectContextPill.innerHTML = `
                <svg class="context-pill-icon project-pill-icon" width="19" height="18" viewBox="0 0 24 22" fill="none" aria-hidden="true">
                    <path d="M9.15 5.25h5.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    <path d="M5.8 8h12.4" stroke="currentColor" stroke-width="2.35" stroke-linecap="round"/>
                    <path d="M6.45 10h11.1l-.45 4.25a2.15 2.15 0 0 1-2.14 1.92H9.04a2.15 2.15 0 0 1-2.14-1.92L6.45 10Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                </svg>
                <span class="context-pill-label">${this.escapeHtml(project.name)}</span>`;
        }
        this.artifactContextPill.hidden = !artifact;
        if (artifact) {
            const count = Math.max(this.getScopedArtifactIds().length, 1);
            this.artifactContextTitle.textContent = `${count} artifact${count === 1 ? '' : 's'}`;
        }
        this.contextPills.hidden = !project && !artifact;
    }

    openArtifactDrawer() {
        const artifact = this.artifacts.find(item => item.id === this.currentArtifactId);
        if (!artifact) return;
        const scopedArtifacts = this.getScopedArtifactIds()
            .map(id => this.artifacts.find(item => item.id === id))
            .filter(Boolean);
        this.artifactDrawerTitle.textContent = artifact.title;
        this.artifactDrawerSelect.innerHTML = '';
        scopedArtifacts.forEach(item => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.title;
            option.selected = item.id === artifact.id;
            this.artifactDrawerSelect.appendChild(option);
        });
        this.artifactDrawerSelect.hidden = scopedArtifacts.length <= 1;
        this.artifactDrawerSource.value = artifact.content;
        this.updateArtifactDrawerPreview(artifact);
        this.artifactDrawerSource.hidden = false;
        this.artifactDrawerPreview.hidden = true;
        this.artifactDrawerViewToggle.lastElementChild.textContent = 'Preview';
        this.artifactDrawerMenu.hidden = true;
        this.artifactDrawerBackdrop.hidden = false;
        this.artifactDrawer.classList.add('open');
        this.artifactDrawer.setAttribute('aria-hidden', 'false');
    }

    openConversationArtifactList() {
        const artifacts = this.getScopedArtifactIds()
            .map(id => this.artifacts.find(item => item.id === id))
            .filter(Boolean);
        if (!artifacts.length) return;

        this.conversationArtifactList.innerHTML = '';
        artifacts.forEach(artifact => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'conversation-artifact-item';
            item.innerHTML = `
                <span class="conversation-artifact-icon">
                    <svg width="30" height="34" viewBox="0 0 30 34" fill="none" aria-hidden="true"><path d="M6 2h12l6 6v24H6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M18 2v7h6M10 17c1.5-2 3 2 4.5 0s3 2 5 0M10 23c1.5-2 3 2 4.5 0s3 2 5 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </span>
                <span class="conversation-artifact-copy">
                    <strong>${this.escapeHtml(artifact.title)}</strong>
                    <small>${this.escapeHtml(this.getArtifactListMeta(artifact))}</small>
                </span>`;
            item.addEventListener('click', () => {
                this.currentArtifactId = artifact.id;
                const conversation = this.getActiveConversation();
                if (conversation) {
                    conversation.artifactId = artifact.id;
                    this.saveActiveConversation();
                }
                this.closeConversationArtifactList();
                this.renderContextPills();
                this.openArtifactDrawer();
            });
            this.conversationArtifactList.appendChild(item);
        });

        this.artifactDownloadAll.querySelector('span').textContent = artifacts.length === 1 ? 'Download' : 'Download all';
        this.artifactListBackdrop.hidden = false;
        this.artifactListSheet.classList.add('open');
        this.artifactListSheet.setAttribute('aria-hidden', 'false');
    }

    closeConversationArtifactList() {
        this.artifactListSheet.classList.remove('open');
        this.artifactListSheet.setAttribute('aria-hidden', 'true');
        this.artifactListBackdrop.hidden = true;
    }

    getArtifactListMeta(artifact) {
        const kind = artifact.type === 'html' ? 'Interactive' : artifact.type === 'code' ? 'Code' : 'Document';
        return `${kind} · ${this.getArtifactLabel(artifact.type)}`;
    }

    getArtifactDocumentIcon() {
        return '<svg width="30" height="34" viewBox="0 0 30 34" fill="none" aria-hidden="true"><path d="M6 2h12l6 6v24H6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M18 2v7h6M10 17c1.5-2 3 2 4.5 0s3 2 5 0M10 23c1.5-2 3 2 4.5 0s3 2 5 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }

    downloadConversationArtifacts() {
        const artifacts = this.getScopedArtifactIds()
            .map(id => this.artifacts.find(item => item.id === id))
            .filter(Boolean);
        artifacts.forEach((artifact, index) => {
            window.setTimeout(() => {
                const extension = ({ html: 'html', markdown: 'md', text: 'txt', code: 'txt' })[artifact.type] || 'txt';
                const filename = `${(artifact.title || 'artifact').replace(/[\\/:*?\"<>|]+/g, '-').trim()}.${extension}`;
                const blob = new Blob([artifact.content || ''], { type: 'text/plain;charset=utf-8' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = filename;
                link.click();
                window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
            }, index * 140);
        });
    }

    closeArtifactDrawer() {
        this.artifactDrawer.classList.remove('open');
        this.artifactDrawer.setAttribute('aria-hidden', 'true');
        this.artifactDrawerBackdrop.hidden = true;
        this.artifactDrawerMenu.hidden = true;
    }

    toggleArtifactDrawerView() {
        const showPreview = this.artifactDrawerPreview.hidden;
        this.artifactDrawerPreview.hidden = !showPreview;
        this.artifactDrawerSource.hidden = showPreview;
        this.artifactDrawerViewToggle.lastElementChild.textContent = showPreview ? 'Source code' : 'Preview';
        this.artifactDrawerMenu.hidden = true;
    }

    updateArtifactDrawerPreview(artifact) {
        if (artifact.type === 'html') {
            this.artifactDrawerPreview.srcdoc = this.withArtifactStorageRuntime(artifact);
        } else if (artifact.type === 'markdown') {
            this.artifactDrawerPreview.srcdoc = `<style>body{font:16px/1.65 system-ui;padding:28px;color:#292925;white-space:pre-wrap}</style>${this.escapeHtml(artifact.content)}`;
        } else {
            this.artifactDrawerPreview.srcdoc = `<style>body{font:14px/1.6 ui-monospace,monospace;padding:24px;white-space:pre-wrap;color:#292925}</style>${this.escapeHtml(artifact.content)}`;
        }
    }

    updateArtifactFromDrawer() {
        const artifact = this.artifacts.find(item => item.id === this.currentArtifactId);
        if (!artifact) return;
        artifact.content = this.artifactDrawerSource.value;
        artifact.updatedAt = new Date().toISOString();
        this.saveArtifacts();
        this.updateArtifactDrawerPreview(artifact);
        if (this.artifactSource && this.currentView === 'artifact') {
            this.artifactSource.value = artifact.content;
            this.updateArtifactPreview(artifact);
        }
        window.clearTimeout(this.artifactDrawerSaveTimer);
        this.artifactDrawerSaveTimer = window.setTimeout(async () => {
            try {
                const response = await fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(artifact)
                });
                if (!response.ok) throw new Error('Save failed');
                Object.assign(artifact, (await response.json()).artifact);
            } catch (error) {
                console.error('Could not save Artifact drawer edit', error);
            }
        }, 350);
    }

    async copyArtifactDrawerSource() {
        const value = this.artifactDrawerSource.value;
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            this.artifactDrawerSource.focus();
            this.artifactDrawerSource.select();
            document.execCommand('copy');
        }
        this.artifactDrawerCopy.lastElementChild.textContent = 'Copied';
        window.setTimeout(() => {
            this.artifactDrawerCopy.lastElementChild.textContent = 'Copy code';
        }, 1200);
        this.artifactDrawerMenu.hidden = true;
    }

    updateChatPlaceholder(conversation = this.getActiveConversation()) {
        const hasMessages = Boolean(conversation?.messages?.length);
        this.messageInput.placeholder = hasMessages ? 'Reply to Claude' : 'Chat with Claude';
    }

    addMessage(role, content) {
        const welcomeScreen = this.messagesContainer.querySelector('.welcome-screen');
        if (welcomeScreen) {
            welcomeScreen.remove();
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = content;

        messageDiv.appendChild(contentDiv);
        this.messagesContainer.appendChild(messageDiv);
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

        if (role === 'user') {
            const conversation = this.getActiveConversation();
            if (conversation) {
                const storedMessage = {
                    role: 'user',
                    content: content
                };
                conversation.messages.push(storedMessage);
                this.saveActiveConversation();
                this.updateChatPlaceholder(conversation);
                this.addUserMessageActions(messageDiv, storedMessage);
            }
        }

        return messageDiv;
    }

    ensureActiveConversation(firstMessage = '') {
        if (this.projectChatMode) {
            if (this.currentProjectChatId) return;
            this.materializeProjectConversation(firstMessage);
            return;
        }

        if (!this.currentConversationId) this.materializeConversation(firstMessage);
    }

    getActiveConversation() {
        if (this.projectChatMode) {
            const project = this.projects.find(item => item.id === this.currentProjectId);
            const ref = this.getProjectConversationRefs(project).find(item => item.chat.id === this.currentProjectChatId || item.id === this.currentProjectChatId);
            return ref?.conversation || ref?.chat || null;
        }
        return this.conversations.find(conversation => conversation.id === this.currentConversationId) || null;
    }

    saveActiveConversation() {
        if (this.projectChatMode) {
            this.saveConversations();
            this.saveProjects();
        } else this.saveConversations();
    }

    getScopedArtifactId() {
        const conversation = this.getActiveConversation();
        if (!conversation) return null;
        if (conversation.artifactId) return conversation.artifactId;
        const inferredId = this.inferArtifactIdForConversation(conversation);
        if (inferredId) {
            conversation.artifactId = inferredId;
            this.saveActiveConversation();
            return inferredId;
        }
        return null;
    }

    getScopedArtifactIds() {
        const conversation = this.getActiveConversation();
        if (!conversation) return [];
        const ids = Array.isArray(conversation.artifactIds) ? conversation.artifactIds : [];
        const legacy = conversation.artifactId ? [conversation.artifactId] : [];
        return Array.from(new Set([...ids, ...legacy]))
            .filter(id => this.artifacts.some(item => item.id === id));
    }

    inferArtifactIdForConversation(conversation) {
        if (!conversation || !Array.isArray(conversation.messages) || !this.artifacts.length) return null;
        const createdTitles = [];
        for (const message of conversation.messages) {
            const content = String(message?.content || '');
            const matches = content.matchAll(/Created artifact:\s*(.+?)(?:\n|$)/gi);
            for (const match of matches) {
                const title = String(match[1] || '').trim();
                if (title) createdTitles.unshift(title);
            }
        }
        for (const title of createdTitles) {
            const normalizedTitle = title.toLowerCase();
            const artifact = this.artifacts.find(item => String(item.title || '').trim().toLowerCase() === normalizedTitle);
            if (artifact) return artifact.id;
        }
        return null;
    }

    setScopedArtifactId(id) {
        const conversation = this.getActiveConversation();
        if (!conversation) return;
        conversation.artifactId = id || null;
        if (id) {
            const ids = Array.isArray(conversation.artifactIds) ? conversation.artifactIds : [];
            conversation.artifactIds = Array.from(new Set([id, ...ids]));
        } else {
            conversation.artifactIds = [];
        }
        this.currentArtifactId = conversation.artifactId;
        this.saveActiveConversation();
    }

    syncCurrentArtifactFromConversation() {
        this.currentArtifactId = this.getScopedArtifactId();
        if (this.currentArtifactId && !this.artifacts.some(item => item.id === this.currentArtifactId)) {
            this.setScopedArtifactId(null);
        }
    }

    syncSendButtonState() {
        const hasText = Boolean(this.messageInput?.value.trim());
        this.voiceBtn.classList.toggle('send-mode', hasText);
        this.voiceBtn.setAttribute('aria-label', hasText ? 'Send message' : 'Start voice input');
        this.voiceBtn.innerHTML = hasText
            ? '<svg class="send-arrow-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 18V6M7 11l5-5 5 5" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<svg class="voice-wave-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.2 10.25v3.5"/><path d="M6.72 7.75v8.5"/><path d="M10.24 2.75v18.5"/><path d="M13.76 7.75v8.5"/><path d="M17.28 5.25v13.5"/><path d="M20.8 10.25v3.5"/></svg>';
    }

    addMessageActions(messageDiv) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';

        const copyBtn = this.createActionButton('copy', () => {
            const content = messageDiv.querySelector('.message-content').textContent;
            navigator.clipboard.writeText(content).then(() => {
                alert('Copied to clipboard!');
            });
        });

        const shareBtn = this.createActionButton('share', () => {
            console.log('Share clicked (no action)');
        });

        const playBtn = this.createActionButton('play', () => {
            const content = messageDiv.querySelector('.message-content').textContent.trim();
            if (!content || !('speechSynthesis' in window)) return;
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(content));
        });

        const likeBtn = this.createActionButton('like', () => {
            console.log('Like clicked (no action)');
        });

        const dislikeBtn = this.createActionButton('dislike', () => {
            console.log('Dislike clicked (no action)');
        });

        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(shareBtn);
        actionsDiv.appendChild(playBtn);
        actionsDiv.appendChild(likeBtn);
        actionsDiv.appendChild(dislikeBtn);

        messageDiv.appendChild(actionsDiv);
    }

    addUserMessageActions(messageDiv, message) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions user-message-actions';
        const copyBtn = this.createActionButton('copy', () => {
            const content = messageDiv.querySelector('.message-content').textContent;
            navigator.clipboard.writeText(content).then(() => {
                alert('Copied to clipboard!');
            });
        });
        const editBtn = this.createActionButton('edit', () => this.editPastMessage(message));
        copyBtn.setAttribute('aria-label', 'Copy message');
        copyBtn.title = 'Copy message';
        editBtn.setAttribute('aria-label', 'Edit and resend message');
        editBtn.title = 'Edit and resend';
        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(editBtn);
        messageDiv.appendChild(actionsDiv);
    }

    editPastMessage(message) {
        const conversation = this.getActiveConversation();
        if (!conversation) return;
        const index = conversation.messages.indexOf(message);
        if (index < 0 || message.role !== 'user') return;
        this.editingMessageIndex = index;
        this.messageInput.value = message.content || '';
        this.syncSendButtonState();
        this.messageInput.focus();
        this.messageInput.setSelectionRange(this.messageInput.value.length, this.messageInput.value.length);
    }

    createActionButton(type, onClick) {
        const button = document.createElement('button');
        button.className = 'action-btn';
        button.dataset.action = type;
        button.onclick = onClick;

        const icons = {
            copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="8" y="8" width="11" height="11" rx="2" stroke-width="1.7"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke-width="1.7" stroke-linecap="round"/></svg>',
            share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M5 13v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 5.5v13L18 12 8 5.5Z" stroke-width="1.7" stroke-linejoin="round"/></svg>',
            like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 11v9H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h2ZM7 20h8.7a2 2 0 0 0 1.94-1.5l1.35-5.4A1.65 1.65 0 0 0 17.4 11H14V7.2A2.2 2.2 0 0 0 11.8 5L7 11v9Z" stroke-width="1.7" stroke-linejoin="round"/></svg>',
            dislike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 13V4H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h2ZM7 4h8.7a2 2 0 0 1 1.94 1.5l1.35 5.4A1.65 1.65 0 0 1 17.4 13H14v3.8a2.2 2.2 0 0 1-2.2 2.2L7 13V4Z" stroke-width="1.7" stroke-linejoin="round"/></svg>',
            edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m14.5 5.5 4 4M4 20l4.2-.9L19.2 8a2.1 2.1 0 0 0-3-3L5.2 16.1 4 20Z" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        };

        const labels = {
            copy: 'Copy response',
            share: 'Share response',
            play: 'Read response aloud',
            like: 'Like response',
            dislike: 'Dislike response',
            edit: 'Edit and resend message'
        };
        button.innerHTML = icons[type];
        button.type = 'button';
        button.setAttribute('aria-label', labels[type] || 'Message action');
        button.title = labels[type] || 'Message action';
        return button;
    }

    createNewConversation() {
        if (this.projectChatMode) {
            this.projectChatMode = false;
            this.currentProjectChatId = null;
            if (this.menuBtn.dataset.originalIcon) this.menuBtn.innerHTML = this.menuBtn.dataset.originalIcon;
            this.menuBtn.setAttribute('aria-label', 'Open sidebar');
        }
        this.currentConversationId = null;
        this.currentArtifactId = null;
        this.pendingAttachments = [];
        this.renderPendingAttachments();
        this.messageInput.value = '';
        this.messagesContainer.innerHTML = this.getWelcomeMarkup();
        this.updateChatPlaceholder(null);
        this.syncConversationHeader();
        this.renderContextPills();
        this.syncSendButtonState();
        this.switchView('chat');
        this.syncScrollBottomButton();
        this.messageInput.focus();
    }

    materializeConversation(firstMessage = '') {
        const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const conversation = {
            id,
            title: firstMessage.slice(0, 30) || 'New conversation',
            messages: [],
            artifactId: null,
            artifactIds: [],
            selectedModel: this.model,
            createdAt: new Date().toISOString()
        };
        this.conversations.unshift(conversation);
        this.currentConversationId = id;
        this.saveConversations();
        this.loadConversations();
        return conversation;
    }

    loadConversation(id) {
        if (this.projectChatMode) {
            this.projectChatMode = false;
            this.currentProjectChatId = null;
            if (this.menuBtn.dataset.originalIcon) this.menuBtn.innerHTML = this.menuBtn.dataset.originalIcon;
            this.currentModelSpan.textContent = this.getCurrentModelName();
        }
        this.currentConversationId = id;
        const conversation = this.conversations.find(c => c.id === id);

        if (!conversation) return;
        if (!conversation.selectedModel) conversation.selectedModel = this.model;
        if (conversation.projectId && conversation.projectChatId) {
            const project = this.projects.find(item => item.id === conversation.projectId);
            const ref = this.getProjectConversationRefs(project).find(item =>
                item.id === conversation.id
                || item.chat.id === conversation.projectChatId
                || item.chat.conversationId === conversation.id
            );
            if (project && ref) {
                this.currentProjectId = project.id;
                this.openProjectChat(ref.chat.id);
                return;
            }
            conversation.projectId = null;
            conversation.projectChatId = null;
            this.saveConversations();
        }
        const imported = this.findImportedProjectChat(conversation.id);
        if (imported) {
            conversation.projectId = imported.project.id;
            conversation.projectChatId = imported.chat.id;
            this.saveConversations();
            this.currentProjectId = imported.project.id;
            this.openProjectChat(imported.chat.id);
            return;
        }
        this.syncCurrentArtifactFromConversation();
        this.syncConversationHeader();
        this.renderContextPills();
        this.updateChatPlaceholder(conversation);
        this.syncSendButtonState();

        this.messagesContainer.innerHTML = '';

        if (conversation.messages.length === 0) {
            this.messagesContainer.innerHTML = this.getWelcomeMarkup();
        } else {
            this.renderStoredMessages(conversation.messages);
        }

        document.querySelectorAll('.chat-history-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === id);
        });
        this.switchView('chat');
        this.scrollConversationToBottom(false);
    }

    isNearConversationBottom(threshold = 72) {
        const container = this.messagesContainer;
        return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    }

    syncScrollBottomButton() {
        if (!this.scrollBottomBtn || !this.messagesContainer) return;
        const hasOverflow = this.messagesContainer.scrollHeight > this.messagesContainer.clientHeight + 8;
        this.scrollBottomBtn.hidden = !hasOverflow || this.isNearConversationBottom();
    }

    scrollConversationToBottom(smooth = false) {
        requestAnimationFrame(() => {
            this.messagesContainer.scrollTo({
                top: this.messagesContainer.scrollHeight,
                behavior: smooth ? 'smooth' : 'auto'
            });
            requestAnimationFrame(() => this.syncScrollBottomButton());
        });
    }

    addMessageToDisplay(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.textContent = content;

        messageDiv.appendChild(contentDiv);
        this.messagesContainer.appendChild(messageDiv);

        return messageDiv;
    }

    getTimeBasedGreeting(date = new Date()) {
        const hour = date.getHours();
        const dayKey = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
        let greetings;

        if (hour < 5 || hour >= 22) {
            greetings = [
                'Hello, night owl.',
                'Still up? What are we working on?',
                'Burning the midnight oil?'
            ];
        } else if (hour < 8) {
            greetings = [
                'Hello, early bird.',
                'Up bright and early?',
                'A fresh start. Where should we begin?'
            ];
        } else if (hour < 12) {
            greetings = [
                'Good morning. Where should we begin?',
                'What are we working on this morning?',
                'Morning. What’s on your mind?'
            ];
        } else if (hour < 18) {
            greetings = [
                'Good afternoon. What are we working on?',
                'Where should we begin this afternoon?',
                'What can I help you make progress on?'
            ];
        } else {
            greetings = [
                'Good evening. What’s on your mind?',
                'What are we working on this evening?',
                'Evening. Where should we begin?'
            ];
        }

        return greetings[Math.abs(dayKey) % greetings.length];
    }

    refreshWelcomeGreeting() {
        const welcomeText = this.messagesContainer?.querySelector('.welcome-text');
        if (!welcomeText || this.projectChatMode || this.getActiveConversation()?.messages?.length) return;
        welcomeText.textContent = this.getTimeBasedGreeting();
    }

    getWelcomeMarkup(title = this.getTimeBasedGreeting()) {
        return `
            <div class="welcome-screen">
                <svg class="welcome-logo" width="60" height="60" viewBox="0 0 100 100" fill="hsl(14.8, 63.1%, 59.6%)" aria-hidden="true">
                    <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z"/>
                </svg>
                <h2 class="welcome-text">${this.escapeHtml(title)}</h2>
            </div>`;
    }

    renderStoredMessages(messages = []) {
        const items = Array.isArray(messages) ? messages : [];
        const lastAssistantIndex = items.findLastIndex(item => item?.role === 'assistant');
        items.forEach((message, index) => this.renderStoredMessage(message, {
            showActivity: index === lastAssistantIndex
        }));
    }

    renderStoredMessage(message, { showActivity = false } = {}) {
        if (message.type === 'thought') return this.addThoughtBlock(message);
        if (message.type === 'tool') return this.addToolBlock(message);
        if (Array.isArray(message.blocks)) {
            message.blocks.forEach(block => {
                if (block.type === 'thought') this.addThoughtBlock(block);
                if (block.type === 'tool') this.addToolBlock(block);
            });
        }
        const node = this.addMessageToDisplay(message.role, message.content || '');
        if (message.role === 'assistant') {
            this.addMessageActions(node);
            if (showActivity) this.createStreamingActivity(node);
        }
        if (message.role === 'user') this.addUserMessageActions(node, message);
        return node;
    }

    addThoughtBlock(data = {}) {
        const block = this.createExpandableBlock({
            kind: 'thought',
            title: 'Thought process',
            summary: data.summary || this.getThoughtSummary(data.content),
            icon: '◔'
        });
        block.querySelector('.response-block-body').textContent = data.content || 'Claude used internal reasoning for this response.';
        this.messagesContainer.appendChild(block);
        return block;
    }

    getThoughtSummary(content = '') {
        const firstLine = String(content)
            .split(/\r?\n/)
            .map(line => line.replace(/^[\s#>*_-]+/, '').replace(/\s+/g, ' ').trim())
            .find(Boolean);
        if (!firstLine) return 'Reasoning completed';
        return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
    }

    addToolBlock(data = {}) {
        const steps = Array.isArray(data.steps) ? data.steps : [];
        const block = this.createExpandableBlock({
            kind: 'tool',
            title: data.title || 'Tool activity',
            summary: data.summary || `${steps.length} steps`,
            icon: '⌘'
        });
        const timeline = document.createElement('div');
        timeline.className = 'tool-timeline';
        steps.forEach((step, index) => {
            const item = document.createElement('div');
            const status = ['complete', 'running', 'error'].includes(step.status) ? step.status : '';
            item.className = `tool-step ${status}`;
            const stepSummary = step.summary || step.detail || step.title || `Step ${index + 1}`;
            item.innerHTML = `
                <span class="tool-step-marker" aria-hidden="true">
                    <span class="tool-step-dot"></span>
                </span>
                <div class="tool-step-content">
                    <div class="tool-step-summary">${this.escapeHtml(stepSummary)}</div>
                </div>`;
            timeline.appendChild(item);
        });
        block.querySelector('.response-block-body').appendChild(timeline);
        this.messagesContainer.appendChild(block);
        return block;
    }

    createExpandableBlock({ kind, title, summary, icon }) {
        const block = document.createElement('section');
        block.className = `response-block ${kind}-block`;
        const iconMarkup = `<span class="response-block-icon thought-clock-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path class="thought-clock-dots" d="M10.1 3.35A8.9 8.9 0 0 0 3.35 10.1"/><path d="M12.8 3.15A8.9 8.9 0 1 1 4.05 13.8"/><path d="M12 7.25v4.85l2.8 1.7"/></svg></span>`;
        block.innerHTML = `
            <button class="response-block-toggle" type="button" aria-expanded="false">
                ${iconMarkup}
                <span class="response-block-title">${this.escapeHtml(title)}</span>
                <span class="response-block-summary">${this.escapeHtml(summary)}</span>
                <svg class="response-block-chevron" width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="m6 4 4 4-4 4" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <div class="response-block-body"></div>`;
        const toggle = block.querySelector('.response-block-toggle');
        toggle.addEventListener('click', () => {
            const expanded = block.classList.toggle('expanded');
            toggle.setAttribute('aria-expanded', String(expanded));
        });
        return block;
    }

    escapeHtml(value) {
        const node = document.createElement('div');
        node.textContent = String(value ?? '');
        return node.innerHTML;
    }

    loadConversations() {
        this.chatHistory.innerHTML = '';

        if (this.conversations.length === 0) {
            this.chatHistory.innerHTML = '<p style="color: var(--text-secondary); padding: 12px;">No conversations yet</p>';
            return;
        }

        [...this.conversations]
            .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)))
            .forEach(conv => {
            const item = document.createElement('div');
            item.className = 'chat-history-item';
            item.dataset.id = conv.id;
            item.textContent = `${conv.starred ? '★ ' : ''}${conv.generatedTitle || conv.title}`;
            item.addEventListener('click', () => {
                this.loadConversation(conv.id);
                this.toggleSidebar();
            });
            this.chatHistory.appendChild(item);
        });
    }

    saveConversations() {
        localStorage.setItem('claude_conversations', JSON.stringify(this.conversations));
        this.scheduleSharedStateSave();
    }

    saveProjects() {
        localStorage.setItem('claude_projects', JSON.stringify(this.projects));
        this.scheduleSharedStateSave();
    }

    scheduleSharedStateSave() {
        if (!this.sharedStateReady) return;
        window.clearTimeout(this.sharedStateSaveTimer);
        this.sharedStateSaveTimer = window.setTimeout(() => this.saveSharedStateToServer(), 180);
    }

    async saveSharedStateToServer() {
        try {
            const response = await fetch('/api/shared-state', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversations: this.conversations, projects: this.projects })
            });
            if (response.ok) this.sharedStateUpdatedAt = (await response.json()).updatedAt || this.sharedStateUpdatedAt;
        } catch (error) {
            console.warn('Conversation sync unavailable', error);
        }
    }

    async syncSharedStateFromServer() {
        try {
            const response = await fetch('/api/shared-state', { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const state = await response.json();
            if (this.sharedStateReady && state.updatedAt && state.updatedAt === this.sharedStateUpdatedAt) return;
            const serverHasData = state.conversations?.length || state.projects?.length;
            const localHasData = this.conversations.length || this.projects.length;
            if (serverHasData) {
                this.conversations = state.conversations || [];
                this.projects = state.projects || [];
                localStorage.setItem('claude_conversations', JSON.stringify(this.conversations));
                localStorage.setItem('claude_projects', JSON.stringify(this.projects));
                this.loadConversations();
                if (this.currentConversationId && this.conversations.some(item => item.id === this.currentConversationId)) {
                    this.loadConversation(this.currentConversationId);
                } else if (this.conversations[0]) {
                    this.loadConversation(this.conversations[0].id);
                }
            }
            this.sharedStateUpdatedAt = state.updatedAt || this.sharedStateUpdatedAt;
            this.sharedStateReady = true;
            if (!serverHasData && localHasData) await this.saveSharedStateToServer();
        } catch (error) {
            this.sharedStateReady = true;
            console.warn('Conversation sync unavailable; using this device only', error);
        }
    }

    async openArtifacts() {
        this.switchView('artifact');
        await this.syncArtifactsFromServer();
        this.renderArtifacts();
    }

    async createArtifact() {
        const draft = {
            id: Date.now().toString(),
            title: 'Untitled HTML artifact',
            type: 'html',
            content: '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My artifact</title>\n  <style>\n    body { font-family: system-ui; padding: 40px; color: #222; }\n    .card { max-width: 520px; padding: 28px; border-radius: 24px; background: #f4efe8; }\n  </style>\n</head>\n<body>\n  <div class="card">\n    <h1>Hello, artifact ✦</h1>\n    <p>Edit the HTML and open Preview to see it render live.</p>\n  </div>\n</body>\n</html>',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const response = await fetch('/api/artifacts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(draft)
        });
        if (!response.ok) throw new Error('Could not create artifact file');
        const { artifact } = await response.json();
        this.artifacts.unshift(artifact);
        this.currentArtifactId = artifact.id;
        this.saveArtifacts();
        this.renderContextPills();
        this.renderArtifacts();
        this.openArtifact(artifact.id);
    }

    renderArtifacts() {
        this.artifactCount.textContent = String(this.artifacts.length);
        this.artifactList.innerHTML = '';

        if (this.artifacts.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'capacity-hint';
            empty.style.padding = '18px 12px';
            empty.textContent = 'No artifacts yet';
            this.artifactList.appendChild(empty);
            this.artifactEmpty.style.display = 'block';
            this.artifactDocument.style.display = 'none';
            this.artifactEditor.classList.remove('open');
            return;
        }

        this.artifacts.forEach(artifact => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `artifact-list-item ${artifact.id === this.currentArtifactId ? 'active' : ''}`;
            button.innerHTML = `
                <span class="artifact-kind">${this.escapeHtml(this.getArtifactLabel(artifact.type))}</span>
                <span class="artifact-list-copy">
                    <span class="artifact-list-title">${this.escapeHtml(artifact.title)}</span>
                    <span class="artifact-list-meta">${this.escapeHtml(this.formatTime(artifact.updatedAt))}</span>
                </span>`;
            button.addEventListener('click', () => this.openArtifact(artifact.id));
            this.artifactList.appendChild(button);
        });

        if (this.currentArtifactId) this.openArtifact(this.currentArtifactId, false);
    }

    openArtifact(id, rerenderList = true) {
        const artifact = this.artifacts.find(item => item.id === id);
        if (!artifact) return;
        this.currentArtifactId = id;
        this.renderContextPills();
        this.artifactEmpty.style.display = 'none';
        this.artifactDocument.style.display = 'flex';
        this.artifactEditor.classList.add('open');
        this.artifactTitleInput.value = artifact.title;
        this.artifactTypeSelect.value = artifact.type;
        this.artifactSource.value = artifact.content;
        this.updateArtifactPreview(artifact);
        this.setArtifactMode(artifact.type === 'html' ? 'preview' : 'edit');
        if (rerenderList) this.renderArtifactListSelection();
    }

    renderArtifactListSelection() {
        this.artifactList.querySelectorAll('.artifact-list-item').forEach((item, index) => {
            item.classList.toggle('active', this.artifacts[index]?.id === this.currentArtifactId);
        });
    }

    updateCurrentArtifact() {
        const artifact = this.artifacts.find(item => item.id === this.currentArtifactId);
        if (!artifact) return;
        artifact.title = this.artifactTitleInput.value.trim() || 'Untitled artifact';
        artifact.type = this.artifactTypeSelect.value;
        artifact.content = this.artifactSource.value;
        artifact.updatedAt = new Date().toISOString();
        this.artifactSaveState.textContent = 'Saving…';
        this.saveArtifacts();
        this.updateArtifactPreview(artifact);
        this.renderArtifactListSelection();
        window.clearTimeout(this.artifactSaveTimer);
        this.artifactSaveTimer = window.setTimeout(async () => {
            try {
                const response = await fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(artifact)
                });
                if (!response.ok) throw new Error('Save failed');
                const result = await response.json();
                Object.assign(artifact, result.artifact);
                this.artifactSaveState.textContent = 'Saved to file';
                this.renderArtifacts();
            } catch (error) {
                this.artifactSaveState.textContent = 'Save failed';
                console.error(error);
            }
        }, 350);
    }

    updateArtifactPreview(artifact) {
        if (artifact.type === 'html') {
            this.artifactPreview.srcdoc = this.withArtifactStorageRuntime(artifact);
        } else if (artifact.type === 'markdown') {
            this.artifactPreview.srcdoc = `<style>body{font:16px/1.65 system-ui;padding:28px;color:#292925;white-space:pre-wrap}</style>${this.escapeHtml(artifact.content)}`;
        } else {
            this.artifactPreview.srcdoc = `<style>body{font:14px/1.6 ui-monospace,monospace;padding:24px;white-space:pre-wrap;color:#292925}</style>${this.escapeHtml(artifact.content)}`;
        }
    }

    findImportedProjectChat(sourceConversationId) {
        if (!sourceConversationId) return null;
        for (const project of this.projects) {
            const chat = (project.chats || []).find(item =>
                item.sourceConversationId === sourceConversationId
                || item.conversationId === sourceConversationId
                || item.id === sourceConversationId
            );
            if (chat) return { project, chat };
        }
        return null;
    }

    setArtifactMode(mode) {
        const preview = mode === 'preview';
        this.artifactSource.style.display = preview ? 'none' : 'block';
        this.artifactPreview.style.display = preview ? 'block' : 'none';
        this.artifactEditMode.classList.toggle('active', !preview);
        this.artifactPreviewMode.classList.toggle('active', preview);
    }

    deleteCurrentArtifact() {
        const artifact = this.artifacts.find(item => item.id === this.currentArtifactId);
        if (!artifact) return;
        this.openActionDialog({
            title: 'Delete Artifact?',
            message: `“${artifact.title}” will be permanently removed.`,
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: () => this.performDeleteCurrentArtifact()
        });
    }

    async performDeleteCurrentArtifact() {
        if (!this.currentArtifactId) return;
        const deletingId = this.currentArtifactId;
        const response = await fetch(`/api/artifacts/${encodeURIComponent(deletingId)}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Could not delete artifact file');
        this.artifacts = this.artifacts.filter(item => item.id !== this.currentArtifactId);
        const conversation = this.getActiveConversation();
        if (conversation) {
            const remainingIds = this.getScopedArtifactIds().filter(id => id !== deletingId);
            conversation.artifactIds = remainingIds;
            conversation.artifactId = remainingIds[0] || null;
            this.currentArtifactId = conversation.artifactId;
            this.saveActiveConversation();
        } else {
            this.currentArtifactId = null;
        }
        this.saveArtifacts();
        this.closeArtifactDrawer();
        this.renderContextPills();
        this.artifactEditor.classList.remove('open');
        this.renderArtifacts();
    }

    getArtifactLabel(type) {
        return ({ html: 'HTML', markdown: 'MD', text: 'TXT', code: '</>' })[type] || 'FILE';
    }

    saveArtifacts() {
        localStorage.setItem('claude_artifacts', JSON.stringify(this.artifacts));
    }

    async syncArtifactsFromServer() {
        const response = await fetch('/api/artifacts');
        if (!response.ok) throw new Error('Could not load artifact files');
        const { artifacts } = await response.json();

        if (artifacts.length === 0 && this.artifacts.length > 0) {
            const migrated = [];
            for (const artifact of this.artifacts) {
                const createResponse = await fetch('/api/artifacts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(artifact)
                });
                if (createResponse.ok) migrated.push((await createResponse.json()).artifact);
            }
            this.artifacts = migrated;
        } else {
            this.artifacts = artifacts;
        }

        if (this.currentArtifactId && !this.artifacts.some(item => item.id === this.currentArtifactId)) {
            this.currentArtifactId = null;
        }
        this.saveArtifacts();
    }

    withArtifactStorageRuntime(artifact) {
        const endpoint = `/api/artifact-storage/${encodeURIComponent(artifact.id)}`;
        const runtime = `<script>
window.storage = {
  async request(action, payload = {}) {
    const response = await fetch(${JSON.stringify(endpoint)}, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({action, ...payload})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Storage operation failed');
    return result;
  },
  get(key, shared = false) { return this.request('get', {key, shared}); },
  set(key, value, shared = false) { return this.request('set', {key, value, shared}); },
  delete(key, shared = false) { return this.request('delete', {key, shared}); },
  list(prefix = '', shared = false) { return this.request('list', {prefix, shared}); }
};
<\/script>`;
        if (/<head[^>]*>/i.test(artifact.content)) {
            return artifact.content.replace(/<head([^>]*)>/i, `<head$1>${runtime}`);
        }
        return `${runtime}${artifact.content}`;
    }
}

function startClaudeChat() {
    try {
        window.claudeChat = new ClaudeChat();
        document.body.removeAttribute('data-app-error');
    } catch (error) {
        document.body.dataset.appError = error.message;
        console.error('Claude interface failed to start', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startClaudeChat, { once: true });
} else {
    startClaudeChat();
}
