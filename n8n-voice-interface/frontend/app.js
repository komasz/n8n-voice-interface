document.addEventListener('DOMContentLoaded', () => {
    // Elementy DOM
    const statusMessage = document.getElementById('status-message');
    const messageContainer = document.getElementById('message-container');
    const messageText = document.getElementById('message-text');
    const webhookUrlInput = document.getElementById('webhook-url');
    const saveSettingsButton = document.getElementById('save-settings');
    const conversationContainer = document.getElementById('conversation-container');
    const recordButton = document.getElementById('record-button');
    
    // Tworzenie interfejsu tekstowego (zastępującego nagrywanie audio)
    createTextInterface();
    
    // Audio player dla odpowiedzi
    let audioPlayer = new Audio();
    
    // Wczytaj zapisany URL webhooka z localStorage
    webhookUrlInput.value = localStorage.getItem('webhookUrl') || '';
    
    // Zapisz URL webhooka do localStorage
    saveSettingsButton.addEventListener('click', () => {
        const webhookUrl = webhookUrlInput.value.trim();
        if (webhookUrl) {
            localStorage.setItem('webhookUrl', webhookUrl);
            showMessage('Ustawienia zapisane pomyślnie!', 'success');
        } else {
            showMessage('Proszę wprowadzić poprawny adres URL webhooka', 'error');
        }
    });
    
    // Funkcja tworząca interfejs tekstowy
    function createTextInterface() {
        // Ukryj przycisk nagrywania
        if (recordButton) {
            recordButton.style.display = 'none';
        }
        
        // Utwórz formularz tekstowy
        const textInterfaceHtml = `
            <div class="text-interface">
                <div class="form-group">
                    <input type="text" id="text-input" placeholder="Wpisz wiadomość..." class="text-input">
                    <button id="send-button" class="btn">
                        <i class="fas fa-paper-plane"></i> Wyślij
                    </button>
                </div>
            </div>
        `;
        
        // Wstaw formularz do kontenera mikrofonu
        const microphoneContainer = document.querySelector('.microphone-container');
        if (microphoneContainer) {
            microphoneContainer.innerHTML = textInterfaceHtml;
            
            // Dodaj obsługę zdarzeń dla formularza
            const textInput = document.getElementById('text-input');
            const sendButton = document.getElementById('send-button');
            
            // Obsługa przycisku Wyślij
            sendButton.addEventListener('click', () => {
                sendText();
            });
            
            // Obsługa naciśnięcia Enter w polu tekstowym
            textInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    sendText();
                }
            });
            
            // Dodaj style CSS do nowego interfejsu
            const style = document.createElement('style');
            style.textContent = `
                .text-interface {
                    width: 100%;
                    margin-top: 20px;
                }
                .form-group {
                    display: flex;
                    gap: 10px;
                }
                .text-input {
                    flex: 1;
                    padding: 12px;
                    border-radius: 20px;
                    border: 1px solid #ccc;
                    font-size: 16px;
                }
                #send-button {
                    background-color: var(--primary-color);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    width: 46px;
                    height: 46px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    transition: all 0.3s ease;
                }
                #send-button:hover {
                    background-color: var(--secondary-color);
                }
            `;
            document.head.appendChild(style);
        }
        
        // Aktualizuj status
        statusMessage.textContent = 'Gotowy do wysyłania wiadomości';
    }
    
    // Funkcja wysyłająca tekst do API
    async function sendText() {
        const textInput = document.getElementById('text-input');
        const text = textInput.value.trim();
        
        if (!text) {
            return;
        }
        
        // Sprawdź, czy URL webhooka jest ustawiony
        const webhookUrl = localStorage.getItem('webhookUrl');
        if (!webhookUrl) {
            showMessage('Proszę najpierw ustawić adres URL webhooka N8N w ustawieniach', 'error');
            return;
        }
        
        // Wyczyść pole tekstowe
        textInput.value = '';
        
        // Utwórz identyfikator wpisu
        const entryId = `entry-${Date.now()}`;
        
        // Dodaj wpis do konwersacji
        addConversationEntry(entryId);
        
        // Aktualizuj wpis konwersacji od razu (bez czekania na API)
        updateConversationEntryWithTranscription(entryId, text);
        
        try {
            // Wyślij tekst bezpośrednio do webhooka
            statusMessage.textContent = 'Wysyłanie wiadomości...';
            
            const response = await fetch('/api/text-message', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    webhook_url: webhookUrl
                })
            });
            
            if (!response.ok) {
                let errorMessage = 'Nie udało się wysłać wiadomości';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorMessage;
                } catch (e) {}
                throw new Error(errorMessage);
            }
            
            const data = await response.json();
            
            // Obsłuż odpowiedź n8n
            if (data.n8nResponse && data.n8nResponse.text) {
                handleN8nResponse(data.n8nResponse.text, entryId);
            } else {
                // Pobierz ostatnią odpowiedź
                try {
                    const n8nResponse = await fetch('/api/last-response-tts');
                    if (n8nResponse.ok) {
                        const responseData = await n8nResponse.json();
                        if (responseData.text) {
                            handleN8nResponse(responseData.text, entryId, responseData.audio_url);
                        } else {
                            handleDefaultResponse(entryId);
                        }
                    } else {
                        handleDefaultResponse(entryId);
                    }
                } catch (error) {
                    handleDefaultResponse(entryId);
                }
            }
            
            statusMessage.textContent = 'Gotowy do wysyłania wiadomości';
            
        } catch (error) {
            console.error('Błąd wysyłania wiadomości:', error);
            updateConversationEntryWithError(entryId, error.message);
            statusMessage.textContent = 'Gotowy do wysyłania wiadomości';
        }
    }
    
    // Funkcje obsługi konwersacji
    function addConversationEntry(entryId) {
        // Usuń najstarsze wpisy, jeśli mamy ich za dużo
        const entries = conversationContainer.querySelectorAll('.conversation-entry');
        if (entries.length >= 10) {
            conversationContainer.removeChild(entries[0]);
        }
        
        // Utwórz nowy wpis
        const entryHtml = `
            <div id="${entryId}" class="conversation-entry">
                <div class="user-message">
                    <div class="message-status">Przetwarzanie...</div>
                    <div class="message-content loading"></div>
                </div>
                <div class="assistant-message hidden">
                    <div class="message-content"></div>
                    <div class="audio-controls hidden">
                        <button class="play-button btn-icon">
                            <i class="fas fa-play"></i> Odtwórz
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        conversationContainer.insertAdjacentHTML('beforeend', entryHtml);
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
        conversationContainer.classList.remove('hidden');
    }
    
    function updateConversationEntryWithTranscription(entryId, text) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const messageStatus = entry.querySelector('.user-message .message-status');
        const messageContent = entry.querySelector('.user-message .message-content');
        
        messageStatus.textContent = 'Ty:';
        messageContent.textContent = text;
        messageContent.classList.remove('loading');
    }
    
    function updateConversationEntryWithResponse(entryId, text, audioUrl) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const assistantMessage = entry.querySelector('.assistant-message');
        const messageContent = assistantMessage.querySelector('.message-content');
        const audioControls = assistantMessage.querySelector('.audio-controls');
        const playButton = audioControls.querySelector('.play-button');
        
        messageContent.textContent = text;
        assistantMessage.classList.remove('hidden');
        audioControls.classList.remove('hidden');
        
        // Ustaw przycisk odtwarzania
        playButton.addEventListener('click', () => {
            playAudioResponse(audioUrl, playButton);
        });
        
        conversationContainer.scrollTop = conversationContainer.scrollHeight;
    }
    
    function updateConversationEntryWithError(entryId, errorText) {
        const entry = document.getElementById(entryId);
        if (!entry) return;
        
        const messageStatus = entry.querySelector('.user-message .message-status');
        const messageContent = entry.querySelector('.user-message .message-content');
        
        messageStatus.textContent = 'Błąd:';
        messageStatus.style.color = 'red';
        messageContent.textContent = errorText;
        messageContent.classList.remove('loading');
    }
    
    // Obsługa odpowiedzi n8n
    async function handleN8nResponse(text, entryId, audioUrl = null) {
        try {
            if (!audioUrl) {
                // Konwertuj tekst na mowę
                const response = await fetch('/api/speak', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: text })
                });
                
                if (response.ok) {
                    const responseData = await response.json();
                    audioUrl = responseData.audio_url;
                } else {
                    throw new Error('Nie udało się przekonwertować tekstu na mowę');
                }
            }
            
            // Aktualizuj wpis konwersacji
            updateConversationEntryWithResponse(entryId, text, audioUrl);
            
            // Odtwórz audio
            playAudioResponse(audioUrl);
            
        } catch (error) {
            console.error('Błąd obsługi odpowiedzi n8n:', error);
            updateConversationEntryWithError(entryId, error.message);
        }
    }
    
    function handleDefaultResponse(entryId) {
        const defaultText = "Nie mogę przetworzyć tej prośby w tej chwili. Czy mogę pomóc w czymś innym?";
        handleN8nResponse(defaultText, entryId);
    }
    
    // Odtwarzanie audio
    function playAudioResponse(audioUrl, buttonElement = null) {
        try {
            audioPlayer.pause();
            audioPlayer.currentTime = 0;
            
            const absoluteUrl = audioUrl.startsWith('http') ? audioUrl : window.location.origin + audioUrl;
            audioPlayer.src = absoluteUrl;
            
            if (buttonElement) {
                buttonElement.disabled = true;
                buttonElement.innerHTML = '<i class="fas fa-volume-up"></i> Odtwarzanie...';
                
                audioPlayer.onended = () => {
                    buttonElement.disabled = false;
                    buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
                };
            }
            
            audioPlayer.play().catch(error => {
                console.error('Błąd odtwarzania audio:', error);
                if (buttonElement) {
                    buttonElement.disabled = false;
                    buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
                }
            });
        } catch (error) {
            console.error('Błąd odtwarzania audio:', error);
        }
    }
    
    // Funkcja pomocnicza do wyświetlania wiadomości
    function showMessage(message, type) {
        messageText.textContent = message;
        messageContainer.classList.remove('hidden', 'success', 'error');
        messageContainer.classList.add(type);
        
        setTimeout(() => {
            messageContainer.classList.add('hidden');
        }, 5000);
    }
    
    // Inicjalizacja z informacją
    showMessage('Interfejs tekstowy aktywny - wpisz wiadomość i naciśnij Enter, aby wysłać', 'success');
});
