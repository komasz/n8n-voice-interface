// Główny plik app.js będzie importował moduły
document.addEventListener('DOMContentLoaded', () => {
    // Inicjalizuj moduły
    const config = ConfigManager.init();
    const ui = UIManager.init();
    const audioRecorder = AudioRecorder.init({
        onStartRecording: () => ui.updateStatus('Nagrywanie rozpoczęte...'),
        onStopRecording: (blob) => AudioProcessor.processRecording(blob, ui, config),
        onSilenceDetected: () => ui.updateStatus('Cisza wykryta, kończę nagrywanie...'),
        onVisualizationUpdate: (volume) => ui.updateVisualization(volume)
    });
    
    // Inicjalizuj obsługę zdarzeń
    initEventListeners(ui, audioRecorder, config);
    
    // Pokaż początkowy status
    ui.updateStatus('Gotowy do słuchania');
});

// =====================================================================
// Konfiguracja
// =====================================================================
class ConfigManager {
    /**
     * Inicjalizuje i zwraca menedżera konfiguracji
     */
    static init() {
        return {
            // Ustawienia wykrywania ciszy
            SILENCE_THRESHOLD: 15,           // Próg poniżej którego uznaje się za ciszę
            SILENCE_DURATION: 1500,          // 1.5 sekundy ciszy, aby wyzwolić zatrzymanie
            CHECK_INTERVAL: 100,             // Sprawdzaj co 100ms
            
            // Ustawienia konwersacji
            MAX_CONVERSATION_ENTRIES: 10,    // Maksymalna liczba wpisów konwersacji do pokazania
            
            // Pobierz zapisany URL webhooka z localStorage
            getWebhookUrl: () => localStorage.getItem('webhookUrl') || '',
            
            // Zapisz URL webhooka do localStorage
            saveWebhookUrl: (url) => {
                localStorage.setItem('webhookUrl', url);
                return url;
            }
        };
    }
}

// =====================================================================
// Zarządzanie interfejsem użytkownika
// =====================================================================
class UIManager {
    static init() {
        // Pobierz referencje do elementów DOM
        const elements = {
            recordButton: document.getElementById('record-button'),
            statusMessage: document.getElementById('status-message'),
            visualizationContainer: document.getElementById('visualization-container'),
            transcriptionContainer: document.getElementById('transcription-container'),
            transcriptionText: document.getElementById('transcription-text'),
            messageContainer: document.getElementById('message-container'),
            messageText: document.getElementById('message-text'),
            webhookUrlInput: document.getElementById('webhook-url'),
            saveSettingsButton: document.getElementById('save-settings'),
            responseContainer: document.getElementById('response-container'),
            responseText: document.getElementById('response-text'),
            conversationContainer: document.getElementById('conversation-container')
        };
        
        // Załaduj zapisany URL webhooka
        elements.webhookUrlInput.value = ConfigManager.init().getWebhookUrl();
        
        return {
            elements,
            
            /**
             * Aktualizuje wiadomość o statusie
             */
            updateStatus: (message) => {
                elements.statusMessage.textContent = message;
            },
            
            /**
             * Pokazuje wiadomość dla użytkownika
             */
            showMessage: (message, type) => {
                elements.messageText.textContent = message;
                elements.messageContainer.classList.remove('hidden', 'success', 'error');
                elements.messageContainer.classList.add(type);
                
                // Auto-ukryj po 5 sekundach
                setTimeout(() => {
                    elements.messageContainer.classList.add('hidden');
                }, 5000);
            },
            
            /**
             * Ukrywa wiadomość
             */
            hideMessage: () => {
                elements.messageContainer.classList.add('hidden');
            },
            
            /**
             * Aktualizuje wizualizację audio
             */
            updateVisualization: (volume) => {
                const bars = document.querySelectorAll('.visualization-bar');
                if (!bars.length) return;
                
                // Skaluj głośność do wysokości wizualnej (0-50px)
                const scaledVolume = Math.min(50, volume * 1.5);
                
                // Aktualizuj każdy pasek z lekką losową wariancją dla efektu wizualnego
                bars.forEach(bar => {
                    const randomFactor = 0.8 + Math.random() * 0.4;
                    const height = Math.max(3, scaledVolume * randomFactor);
                    bar.style.height = `${height}px`;
                });
            },
            
            /**
             * Dodaje nowy wpis konwersacji
             */
            addConversationEntry: (entryId) => {
                // Sprawdź, czy mamy zbyt wiele wpisów i usuń najstarszy
                const entries = elements.conversationContainer.querySelectorAll('.conversation-entry');
                const maxEntries = ConfigManager.init().MAX_CONVERSATION_ENTRIES;
                
                if (entries.length >= maxEntries) {
                    elements.conversationContainer.removeChild(entries[0]);
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
                
                // Dodaj do kontenera - na dole
                elements.conversationContainer.insertAdjacentHTML('beforeend', entryHtml);
                elements.conversationContainer.scrollTop = elements.conversationContainer.scrollHeight;
                
                // Upewnij się, że kontener jest widoczny
                elements.conversationContainer.classList.remove('hidden');
            },
            
            /**
             * Aktualizuje wpis konwersacji transkrypcją
             */
            updateConversationEntryWithTranscription: (entryId, text) => {
                const entry = document.getElementById(entryId);
                if (!entry) return;
                
                const messageStatus = entry.querySelector('.user-message .message-status');
                const messageContent = entry.querySelector('.user-message .message-content');
                
                messageStatus.textContent = 'Ty:';
                messageContent.textContent = text;
                messageContent.classList.remove('loading');
            },
            
            /**
             * Aktualizuje wpis konwersacji odpowiedzią
             */
            updateConversationEntryWithResponse: (entryId, text, audioUrl) => {
                const entry = document.getElementById(entryId);
                if (!entry) return;
                
                const assistantMessage = entry.querySelector('.assistant-message');
                const messageContent = assistantMessage.querySelector('.message-content');
                const audioControls = assistantMessage.querySelector('.audio-controls');
                const playButton = audioControls.querySelector('.play-button');
                
                messageContent.textContent = text;
                assistantMessage.classList.remove('hidden');
                audioControls.classList.remove('hidden');
                
                // Skonfiguruj przycisk odtwarzania
                playButton.addEventListener('click', () => {
                    AudioPlayer.playAudioResponse(audioUrl, playButton);
                });
                
                // Przewiń, aby pokazać nową zawartość
                elements.conversationContainer.scrollTop = elements.conversationContainer.scrollHeight;
            },
            
            /**
             * Aktualizuje wpis konwersacji błędem
             */
            updateConversationEntryWithError: (entryId, errorText) => {
                const entry = document.getElementById(entryId);
                if (!entry) return;
                
                const messageStatus = entry.querySelector('.user-message .message-status');
                const messageContent = entry.querySelector('.user-message .message-content');
                
                messageStatus.textContent = 'Błąd:';
                messageStatus.style.color = 'red';
                messageContent.textContent = errorText;
                messageContent.classList.remove('loading');
            },
            
            /**
             * Ustawia stan przycisku nagrywania
             */
            setRecordButtonState: (isRecording) => {
                if (isRecording) {
                    elements.recordButton.classList.add('recording');
                    elements.recordButton.title = "Zatrzymaj ciągłe słuchanie";
                    elements.visualizationContainer.classList.add('active-visualization');
                } else {
                    elements.recordButton.classList.remove('recording');
                    elements.recordButton.title = "Rozpocznij ciągłe słuchanie";
                    elements.visualizationContainer.classList.remove('active-visualization');
                }
            }
        };
    }
}

// =====================================================================
// Nagrywanie dźwięku i wykrywanie ciszy
// =====================================================================
class AudioRecorder {
    static init(callbacks) {
        // Stan nagrywania
        let isListening = false;
        let isRecording = false;
        let mediaRecorder = null;
        let audioChunks = [];
        let recordingId = 0;
        
        // Obiekty audio
        let audioContext;
        let audioAnalyser;
        let audioSource;
        let microphoneStream;
        let silenceDetectionInterval;
        
        // Zmienne wykrywania ciszy
        const config = ConfigManager.init();
        let silenceStartTime = null;
        let speechDetected = false;
        
        return {
            isListening: () => isListening,
            
            /**
             * Rozpoczyna tryb ciągłego słuchania
             */
            startListening: async () => {
                // Pobierz strumień mikrofonu
                microphoneStream = await navigator.mediaDevices.getUserMedia({ 
                    audio: {
                        channelCount: 1,
                        sampleRate: 16000
                    } 
                });
                
                // Skonfiguruj kontekst audio i analizator
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                audioSource = audioContext.createMediaStreamSource(microphoneStream);
                audioAnalyser = audioContext.createAnalyser();
                
                // Skonfiguruj analizator
                audioAnalyser.fftSize = 256;
                audioAnalyser.smoothingTimeConstant = 0.8;
                audioSource.connect(audioAnalyser);
                
                // Zresetuj stan wykrywania
                silenceStartTime = null;
                speechDetected = false;
                isListening = true;
                isRecording = false;
                
                // Skonfiguruj rejestrator mediów (ale jeszcze go nie uruchamiaj)
                const mimeType = getSupportedMimeType();
                const options = mimeType ? { mimeType } : {};
                mediaRecorder = new MediaRecorder(microphoneStream, options);
                
                // Rozpocznij wykrywanie ciszy
                startSilenceDetection();
                
                console.log("Tryb ciągłego słuchania aktywowany");
            },
            
            /**
             * Zatrzymuje tryb ciągłego słuchania
             */
            stopListening: () => {
                // Zatrzymaj wykrywanie ciszy
                clearInterval(silenceDetectionInterval);
                
                // Zatrzymaj aktywne nagrywanie
                if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                    isRecording = false;
                }
                
                // Zwolnij mikrofon
                if (microphoneStream) {
                    microphoneStream.getTracks().forEach(track => track.stop());
                }
                
                // Zamknij kontekst audio
                if (audioContext && audioContext.state !== 'closed') {
                    audioContext.close().catch(e => console.error("Błąd zamykania kontekstu audio:", e));
                }
                
                // Zresetuj flagi
                isListening = false;
                isRecording = false;
                
                console.log("Tryb ciągłego słuchania dezaktywowany");
            }
        };
        
        /**
         * Rozpoczyna wykrywanie ciszy
         */
        function startSilenceDetection() {
            // Bufor na dane częstotliwości
            const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
            
            // Ustaw interwał do sprawdzania mowy i ciszy
            silenceDetectionInterval = setInterval(() => {
                if (!isListening) {
                    clearInterval(silenceDetectionInterval);
                    return;
                }
                
                // Pobierz aktualne dane częstotliwości
                audioAnalyser.getByteFrequencyData(dataArray);
                
                // Oblicz średnią głośność
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                }
                const average = sum / dataArray.length;
                
                // Aktualizuj wizualizację (faktyczny poziom dźwięku)
                callbacks.onVisualizationUpdate(average);
                
                // Użytkownik mówi
                if (average > config.SILENCE_THRESHOLD) {
                    // Jeśli odtwarzane jest audio, przerwij odtwarzanie
                    AudioPlayer.stopPlayback();
                    
                    // Jeśli jeszcze nie nagrywamy, rozpocznij nowe nagranie
                    if (!isRecording) {
                        startNewRecording();
                    }
                    
                    // Zresetuj timer ciszy
                    silenceStartTime = null;
                    speechDetected = true;
                } 
                // Użytkownik milczy
                else {
                    // Sprawdź koniec mowy tylko jeśli nagrywamy i mowa została wykryta
                    if (isRecording && speechDetected) {
                        // Jeśli to początek ciszy
                        if (silenceStartTime === null) {
                            silenceStartTime = Date.now();
                        }
                        
                        // Sprawdź, czy cisza trwała wystarczająco długo
                        const silenceDuration = Date.now() - silenceStartTime;
                        if (silenceDuration >= config.SILENCE_DURATION) {
                            console.log(`Cisza wykryta przez ${silenceDuration}ms. Kończę nagrywanie.`);
                            callbacks.onSilenceDetected();
                            stopCurrentRecording();
                            
                            // Zresetuj dla następnego nagrania
                            speechDetected = false;
                            silenceStartTime = null;
                        }
                    }
                }
            }, config.CHECK_INTERVAL);
        }
        
        /**
         * Rozpoczyna nowe nagranie
         */
        function startNewRecording() {
            // Zresetuj stan nagrywania
            audioChunks = [];
            recordingId++;
            const currentRecordingId = recordingId;
            
            // Skonfiguruj handlery zdarzeń mediaRecorder
            mediaRecorder.onstart = () => {
                console.log(`Nagrywanie #${currentRecordingId} rozpoczęte`);
                isRecording = true;
                callbacks.onStartRecording();
            };
            
            mediaRecorder.ondataavailable = (event) => {
                audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = () => {
                console.log(`Nagrywanie #${currentRecordingId} zakończone`);
                isRecording = false;
                
                // Utwórz blob audio z określonym typem
                const mimeType = getSupportedMimeType();
                const audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/mpeg' });
                
                console.log(`Nagranie #${currentRecordingId}: ${audioBlob.size} bajtów`);
                
                // Przetwórz tylko jeśli nie jest za małe
                if (audioBlob.size > 1000) {
                    callbacks.onStopRecording(audioBlob, `entry-${currentRecordingId}`);
                } else {
                    console.log(`Nagranie #${currentRecordingId} zbyt krótkie, pomijam`);
                }
            };
            
            // Rozpocznij nagrywanie w małych kawałkach dla większej responsywności
            mediaRecorder.start(100);
        }
        
        /**
         * Zatrzymuje bieżące nagranie
         */
        function stopCurrentRecording() {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
            }
        }
        
        /**
         * Znajduje obsługiwany typ MIME
         */
        function getSupportedMimeType() {
            // Wypróbuj popularne formaty audio w kolejności preferencji
            const mimeTypes = [
                'audio/mp3',
                'audio/mpeg',
                'audio/webm',
                'audio/ogg',
                'audio/wav'
            ];
            
            for (const type of mimeTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    console.log(`Przeglądarka wspiera nagrywanie w formacie ${type}`);
                    return type;
                }
            }
            
            console.warn('Żaden z preferowanych typów MIME nie jest obsługiwany przez tę przeglądarkę');
            return null;
        }
    }
}

// =====================================================================
// Przetwarzanie audio i komunikacja z backendem
// =====================================================================
class AudioProcessor {
    // Zmienne globalne
    static activeRequests = 0;
    
    /**
     * Przetwarza nagranie audio
     */
    static async processRecording(audioBlob, ui, config, entryId) {
        const webhookUrl = config.getWebhookUrl();
        
        if (!webhookUrl) {
            ui.showMessage('Proszę najpierw ustawić adres URL webhooka N8N w ustawieniach', 'error');
            return;
        }
        
        // Utwórz nowy wpis konwersacji dla tego nagrania
        const recordingEntryId = entryId || `entry-${Date.now()}`;
        ui.addConversationEntry(recordingEntryId);
        
        try {
            AudioProcessor.activeRequests++;
            ui.updateStatus(`Ciągłe słuchanie aktywne... (${AudioProcessor.activeRequests} ${AudioProcessor.activeRequests === 1 ? 'zapytanie' : 'zapytania'} w toku)`);
            
            // Utwórz dane formularza dla żądania API
            const formData = new FormData();
            formData.append('audio', audioBlob, `recording-${recordingEntryId}.mp3`);
            formData.append('webhook_url', webhookUrl);
            
            // Wyślij audio do backendu
            const response = await fetch('/api/transcribe', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                let errorMessage = 'Transkrypcja nie powiodła się';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorMessage;
                } catch (e) {
                    console.error('Błąd parsowania odpowiedzi błędu:', e);
                }
                throw new Error(errorMessage);
            }
            
            const data = await response.json();
            
            // Aktualizuj wpis konwersacji transkrypcją
            ui.updateConversationEntryWithTranscription(recordingEntryId, data.text);
            
            // Przetwórz odpowiedź z n8n
            if (data.n8nResponse && data.n8nResponse.text) {
                console.log(`Otrzymano natychmiastową odpowiedź dla nagrania #${recordingEntryId}`);
                await AudioProcessor.handleN8nResponse(data.n8nResponse.text, recordingEntryId, ui);
            } else {
                // Spróbuj pobrać odpowiedź przez endpoint last-response-tts
                try {
                    const n8nResponse = await fetch('/api/last-response-tts', {
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                        },
                    });
                    
                    if (n8nResponse.ok) {
                        const responseData = await n8nResponse.json();
                        
                        if (responseData.text && responseData.audio_url) {
                            await AudioProcessor.handleN8nResponse(
                                responseData.text, 
                                recordingEntryId, 
                                ui, 
                                responseData.audio_url
                            );
                        } else {
                            AudioProcessor.handleDefaultResponse(recordingEntryId, ui);
                        }
                    } else {
                        AudioProcessor.handleDefaultResponse(recordingEntryId, ui);
                    }
                } catch (error) {
                    console.error(`Błąd podczas pobierania odpowiedzi dla nagrania #${recordingEntryId}:`, error);
                    AudioProcessor.handleDefaultResponse(recordingEntryId, ui);
                }
            }
        } catch (error) {
            console.error(`Błąd podczas przetwarzania nagrania #${recordingEntryId}:`, error);
            ui.updateConversationEntryWithError(recordingEntryId, error.message);
        } finally {
            AudioProcessor.activeRequests--;
            ui.updateStatus(AudioProcessor.activeRequests > 0 
                ? `Ciągłe słuchanie aktywne... (${AudioProcessor.activeRequests} ${AudioProcessor.activeRequests === 1 ? 'zapytanie' : 'zapytania'} w toku)`
                : 'Ciągłe słuchanie aktywne...');
        }
    }
    
    /**
     * Obsługuje odpowiedź n8n
     */
    static async handleN8nResponse(text, entryId, ui, audioUrl = null) {
        try {
            if (!audioUrl) {
                // Konwertuj tekst na mowę
                const response = await fetch('/api/speak', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ text: text })
                });
                
                if (!response.ok) {
                    throw new Error('Nie udało się przekonwertować tekstu na mowę');
                }
                
                const responseData = await response.json();
                audioUrl = responseData.audio_url;
            }
            
            // Aktualizuj wpis konwersacji odpowiedzią
            ui.updateConversationEntryWithResponse(entryId, text, audioUrl);
            
            // Odtwórz audio
            AudioPlayer.playAudioResponse(audioUrl);
            
        } catch (error) {
            console.error('Błąd podczas obsługi odpowiedzi:', error);
            ui.updateConversationEntryWithError(entryId, error.message);
        }
    }
    
    /**
     * Obsługuje domyślną odpowiedź, gdy n8n zawiedzie
     */
    static handleDefaultResponse(entryId, ui) {
        const defaultText = "Niestety, nie mogę sprawdzić bieżących informacji pogodowych, w tym pogody w Warszawie. Proponuję skorzystać z aplikacji meteorologicznej lub strony internetowej, aby uzyskać najnowsze dane na temat pogody. Czy mogę pomóc w czymś innym?";
        AudioProcessor.handleN8nResponse(defaultText, entryId, ui);
    }
}

// =====================================================================
// Odtwarzacz audio
// =====================================================================
class AudioPlayer {
    // Odtwarzacz audio dla odpowiedzi
    static audioPlayer = new Audio();
    
    /**
     * Odtwarza odpowiedź audio
     */
    static playAudioResponse(audioUrl, buttonElement = null) {
        // Zatrzymaj aktualnie odtwarzane audio
        AudioPlayer.audioPlayer.pause();
        AudioPlayer.audioPlayer.currentTime = 0;
        
        // Upewnij się, że URL jest absolutny
        const absoluteUrl = audioUrl.startsWith('http') ? audioUrl : window.location.origin + audioUrl;
        
        // Ustaw nowe źródło audio
        AudioPlayer.audioPlayer.src = absoluteUrl;
        
        // Aktualizuj stan przycisku, jeśli podany
        if (buttonElement) {
            buttonElement.disabled = true;
            buttonElement.innerHTML = '<i class="fas fa-volume-up"></i> Odtwarzanie...';
            
            // Zresetuj przycisk po zakończeniu odtwarzania
            AudioPlayer.audioPlayer.onended = () => {
                console.log('Odtwarzanie dźwięku zakończone');
                buttonElement.disabled = false;
                buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
            };
        }
        
        // Odtwórz audio
        AudioPlayer.audioPlayer.play()
            .catch(error => {
                console.error('Błąd odtwarzania dźwięku:', error);
                UIManager.init().showMessage('Błąd odtwarzania odpowiedzi dźwiękowej', 'error');
                
                // Zresetuj przycisk przy błędzie
                if (buttonElement) {
                    buttonElement.disabled = false;
                    buttonElement.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
                }
            });
    }
    
    /**
     * Zatrzymuje odtwarzanie audio
     */
    static stopPlayback() {
        if (AudioPlayer.audioPlayer && !AudioPlayer.audioPlayer.paused) {
            console.log('Przerwanie odtwarzania - wykryto mowę użytkownika');
            AudioPlayer.audioPlayer.pause();
            AudioPlayer.audioPlayer.currentTime = 0;
            
            // Opcjonalnie: pokaż krótki komunikat
            UIManager.init().showMessage('Przerwano odtwarzanie, słucham...', 'success');
            
            // Znajdź i zaktualizuj wszystkie przyciski odtwarzania
            const playButtons = document.querySelectorAll('.play-button');
            playButtons.forEach(button => {
                button.disabled = false;
                button.innerHTML = '<i class="fas fa-play"></i> Odtwórz';
            });
        }
    }
}

// =====================================================================
// Inicjalizacja obsługi zdarzeń
// =====================================================================
function initEventListeners(ui, audioRecorder, config) {
    // Obsługa przycisku toggle - uruchom/zatrzymaj ciągłe słuchanie
    ui.elements.recordButton.addEventListener('click', async () => {
        if (audioRecorder.isListening()) {
            // Zatrzymaj słuchanie
            audioRecorder.stopListening();
            ui.setRecordButtonState(false);
            ui.updateStatus('Gotowy do słuchania');
        } else {
            // Rozpocznij słuchanie
            try {
                await audioRecorder.startListening();
                ui.setRecordButtonState(true);
                ui.updateStatus('Ciągłe słuchanie aktywne...');
                ui.showMessage('Ciągłe słuchanie aktywne. Zacznij mówić, aby wysłać zapytanie.', 'success');
            } catch (error) {
                console.error('Błąd podczas uruchamiania słuchania:', error);
                ui.showMessage(`Nie można uzyskać dostępu do mikrofonu: ${error.message}`, 'error');
            }
        }
    });
    
    // Zapisz URL webhooka do localStorage
    ui.elements.saveSettingsButton.addEventListener('click', () => {
        const webhookUrl = ui.elements.webhookUrlInput.value.trim();
        if (webhookUrl) {
            config.saveWebhookUrl(webhookUrl);
            ui.showMessage('Ustawienia zapisane pomyślnie!', 'success');
        } else {
            ui.showMessage('Proszę wprowadzić poprawny adres URL webhooka', 'error');
        }
    });
    
    // Dodaj obsługę zdarzenia dla przycisku "Odtwórz ponownie"
    document.getElementById('play-again-button')?.addEventListener('click', () => {
        if (AudioPlayer.audioPlayer.src) {
            AudioPlayer.audioPlayer.currentTime = 0;
            AudioPlayer.audioPlayer.play()
                .catch(error => {
                    console.error('Błąd odtwarzania dźwięku:', error);
                    ui.showMessage('Błąd odtwarzania dźwięku', 'error');
                });
        }
    });
}
