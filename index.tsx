/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import {marked} from 'marked';
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.API_KEY;

const ai = new GoogleGenAI({apiKey: API_KEY});

const modeSelector = document.getElementById('mode-selector') as HTMLDivElement;
const form = document.getElementById('model-form') as HTMLFormElement;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const aspectRatioContainer = document.getElementById('aspect-ratio-container') as HTMLDivElement;
const aspectRatioSelect = document.getElementById('aspect-ratio-select') as HTMLSelectElement;
const videoSettingsContainer = document.getElementById('video-settings-container') as HTMLDivElement;
const videoResolutionSelect = document.getElementById('video-resolution-select') as HTMLSelectElement;
const videoFpsSelect = document.getElementById('video-fps-select') as HTMLSelectElement;
const promptInput = document.getElementById('prompt-input') as HTMLTextAreaElement;
const imageUploadInput = document.getElementById('image-upload') as HTMLInputElement;
const imageUploadLabel = document.querySelector('.image-upload-label') as HTMLLabelElement;
const imagePreviewContainer = document.getElementById('image-preview-container') as HTMLDivElement;
const imagePreview = document.getElementById('image-preview') as HTMLImageElement;
const removeImageButton = document.getElementById('remove-image-button') as HTMLButtonElement;
const responseContainer = document.getElementById('response-container') as HTMLDivElement;
const responseHeader = document.getElementById('response-header') as HTMLDivElement;
const copyButton = document.getElementById('copy-button') as HTMLButtonElement;
const downloadButton = document.getElementById('download-button') as HTMLButtonElement;
const loader = document.getElementById('loader') as HTMLDivElement;

// Model definitions
const CHAT_MODELS = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
};
const IMAGE_MODELS = {
  'imagen-4.0-generate-001': 'Imagen 4',
};
const VIDEO_MODELS = {
  'veo-2.0-generate-001': 'Veo 2',
};

// Store the raw text response for the copy button
let rawResponseText = '';
// Store generated media for download
let generatedMedia: { url: string, type: 'image' | 'video' } | null = null;
// Store the uploaded image data
let uploadedImage: { mimeType: string; data: string } | null = null;

/**
 * Populates the model select dropdown based on the current mode.
 */
function populateModelSelect(mode: 'chat' | 'image' | 'video') {
  modelSelect.innerHTML = '';
  const models = mode === 'chat' ? CHAT_MODELS : mode === 'image' ? IMAGE_MODELS : VIDEO_MODELS;
  for (const [id, name] of Object.entries(models)) {
    const option = document.createElement('option');
    option.value = `models/${id}`;
    option.textContent = name;
    modelSelect.appendChild(option);
  }
}

/**
 * Updates the UI visibility and state based on the selected mode.
 */
function updateUIMode(mode: 'chat' | 'image' | 'video') {
  // Clear previous results
  responseContainer.innerHTML = '';
  responseHeader.classList.add('hidden');
  promptInput.value = '';

  aspectRatioContainer.classList.add('hidden');
  imageUploadLabel.classList.add('hidden');
  videoSettingsContainer.classList.add('hidden');
  
  if (mode === 'chat' || mode === 'video') {
    imageUploadLabel.classList.remove('hidden');
    if (uploadedImage) {
      imagePreviewContainer.classList.remove('hidden');
    } else {
      imagePreviewContainer.classList.add('hidden');
    }
    promptInput.placeholder = mode === 'chat' 
      ? 'e.g., Explain to me how AI works, or describe this image'
      : 'e.g., A neon hologram of a cat driving at top speed';
    // Fix: The video settings for resolution and frame rate are not supported by the API, so the UI is hidden.
  } else { // image mode
    aspectRatioContainer.classList.remove('hidden');
    imagePreviewContainer.classList.add('hidden');
    promptInput.placeholder = 'e.g., A robot holding a red skateboard.';
  }
  populateModelSelect(mode);
}

/**
 * Converts a File object to a base64 encoded string.
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
  });
}

modeSelector.addEventListener('change', (e) => {
  const selectedMode = (e.target as HTMLInputElement).value;
  if (selectedMode === 'chat' || selectedMode === 'image' || selectedMode === 'video') {
    updateUIMode(selectedMode);
  }
});

imageUploadInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    return;
  }

  try {
    const base64Data = await fileToBase64(file);
    uploadedImage = { mimeType: file.type, data: base64Data };
    imagePreview.src = `data:${file.type};base64,${base64Data}`;
    imagePreviewContainer.classList.remove('hidden');
  } catch (error) {
    console.error('Error reading file:', error);
    alert('Failed to read image file.');
  }
});

removeImageButton.addEventListener('click', () => {
  uploadedImage = null;
  imageUploadInput.value = '';
  imagePreviewContainer.classList.add('hidden');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const currentMode = (document.querySelector('input[name="mode"]:checked') as HTMLInputElement).value;
  const prompt = promptInput.value.trim();

  if ((currentMode === 'chat' && !prompt && !uploadedImage) || (currentMode !== 'chat' && !prompt)) {
    alert('Please enter a prompt.');
    return;
  }

  responseContainer.innerHTML = '';
  responseHeader.classList.add('hidden');
  downloadButton.classList.add('hidden');
  loader.classList.remove('hidden');
  loader.textContent = 'Thinking...';
  rawResponseText = '';
  generatedMedia = null;

  const selectedModel = modelSelect.value.replace('models/', '');

  try {
    if (currentMode === 'chat') {
      let contents: any;
      if (uploadedImage) {
        const imagePart = { inlineData: { mimeType: uploadedImage.mimeType, data: uploadedImage.data } };
        const textPart = { text: prompt };
        contents = { parts: [imagePart, textPart] };
      } else {
        contents = prompt;
      }

      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: contents,
      });

      if (!response.candidates || response.candidates.length === 0) {
        if (response.promptFeedback?.blockReason) {
            let reason = `Your prompt was blocked. Reason: ${response.promptFeedback.blockReason}.`;
            const safetyDetails = response.promptFeedback.safetyRatings
                // FIX: This comparison appears to be unintentional because the types 'HarmProbability' and '"HARMLESS"' have no overlap. The correct value is 'NEGLIGIBLE'.
                .filter(rating => rating.probability !== 'NEGLIGIBLE')
                .map(rating => `\n- Category: ${rating.category}, Probability: ${rating.probability}`)
                .join('');
            if (safetyDetails) {
                reason += `\n\nDetails:${safetyDetails}`;
            }
            throw new Error(reason);
        } else {
            throw new Error('The model did not return a response. This may be due to the safety policy.');
        }
      }
      
      rawResponseText = response.text;
      responseContainer.innerHTML = await marked.parse(rawResponseText);
      responseHeader.classList.remove('hidden');
      copyButton.classList.remove('hidden');
      copyButton.textContent = 'Copy';
    } else if (currentMode === 'image') {
      const selectedAspectRatio = aspectRatioSelect.value;
      const response = await ai.models.generateImages({
        model: selectedModel,
        prompt: prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: selectedAspectRatio,
        },
      });
      
      if (!response.generatedImages || response.generatedImages.length === 0) {
        // FIX: Property 'promptFeedback' does not exist on type 'GenerateImagesResponse'.
        throw new Error('Image generation completed, but no image was returned. Your prompt may have been blocked by the content policy.');
      }

      const base64ImageBytes = response.generatedImages[0].image.imageBytes;
      const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
      generatedMedia = { url: imageUrl, type: 'image' };
      
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = prompt;
      responseContainer.appendChild(img);
      responseHeader.classList.remove('hidden');
      copyButton.classList.add('hidden');
      downloadButton.classList.remove('hidden');
    } else { // video generation mode
      const videoStatusMessages = [
        'Generating video frames...',
        'Encoding video...',
        'Finalizing...',
      ];
      let statusIndex = 0;
      loader.textContent = 'Initiating video generation...';

      let operation = await ai.models.generateVideos({
          model: selectedModel,
          prompt: prompt,
          image: uploadedImage ? { 
            imageBytes: uploadedImage.data, 
            mimeType: uploadedImage.mimeType 
          } : undefined,
          config: {
              numberOfVideos: 1,
          }
      });

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({operation: operation});

        const progress = (operation.metadata as any)?.progressPercent;
        if (typeof progress === 'number') {
          if (progress < 35) {
            loader.textContent = `Generating video frames... (${progress}%)`;
          } else if (progress < 70) {
            loader.textContent = `Encoding video... (${progress}%)`;
          } else {
            loader.textContent = `Finalizing... (${progress}%)`;
          }
        } else {
          loader.textContent = videoStatusMessages[statusIndex++ % videoStatusMessages.length];
        }
      }

      if (operation.error) {
        // FIX: Argument of type 'unknown' is not assignable to parameter of type 'string'. Cast to string.
        throw new Error(String(operation.error.message) || 'Video generation failed with an unknown API error.');
      }

      const videoResponse = operation.response;
      if (!videoResponse?.generatedVideos || videoResponse.generatedVideos.length === 0) {
          // FIX: Property 'promptFeedback' does not exist on type 'GenerateVideosResponse'.
          throw new Error('Video generation completed, but no video was returned. Your prompt may have been blocked by the content policy.');
      }

      const downloadLink = videoResponse.generatedVideos[0]?.video?.uri;
      if (!downloadLink) {
        throw new Error('Video generation completed, but no video URI was found in the response.');
      }
      
      loader.textContent = 'Downloading video...';
      const fetchedVideo = await fetch(`${downloadLink}&key=${API_KEY}`);
      if (!fetchedVideo.ok) {
        throw new Error(`Failed to download video: ${fetchedVideo.statusText}`);
      }

      const videoBlob = await fetchedVideo.blob();
      const videoUrl = URL.createObjectURL(videoBlob);
      generatedMedia = { url: videoUrl, type: 'video' };
      
      const video = document.createElement('video');
      video.src = videoUrl;
      video.controls = true;
      responseContainer.appendChild(video);
      responseHeader.classList.remove('hidden');
      copyButton.classList.add('hidden');
      downloadButton.classList.remove('hidden');
    }
  } catch (error) {
    console.error(error);
    let errorMessage = 'An unknown error occurred. Please check the console for more details.';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'object' && error && 'message' in error) {
      errorMessage = String((error as {message: any}).message);
    }
    
    // Parse the error to show a cleaner message
    const prefix = '[GoogleGenerativeAI Error]: ';
    if (errorMessage.startsWith(prefix)) {
      errorMessage = errorMessage.substring(prefix.length);
    }

    const errorP = document.createElement('p');
    errorP.className = 'error';
    errorP.textContent = errorMessage;
    responseContainer.innerHTML = '';
    responseContainer.appendChild(errorP);
  } finally {
    loader.classList.add('hidden');
    loader.textContent = 'Thinking...';
  }
});

copyButton.addEventListener('click', () => {
  if (!rawResponseText) return;

  navigator.clipboard.writeText(rawResponseText).then(() => {
    copyButton.textContent = 'Copied!';
    setTimeout(() => { copyButton.textContent = 'Copy'; }, 2000);
  }).catch(err => {
    console.error('Failed to copy: ', err);
    alert('Failed to copy response.');
  });
});

downloadButton.addEventListener('click', () => {
  if (!generatedMedia) return;

  const a = document.createElement('a');
  a.href = generatedMedia.url;
  // Create a sanitized filename from the prompt
  const filename = (promptInput.value.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') || 'generated_media').substring(0, 50);
  const extension = generatedMedia.type === 'image' ? 'jpg' : 'mp4';
  a.download = `${filename}.${extension}`;
  document.body.appendChild(a); // Append to body to be clickable in Firefox
  a.click();
  document.body.removeChild(a); // Clean up
});

// Initial setup
updateUIMode('chat');
