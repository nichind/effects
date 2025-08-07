/**
 * Modern Effects System
 * A lightweight, high-performance animation library for web applications
 * Triggers animations based on element visibility and user interaction
 * 
 * @version 0.3
 * @license MIT
 * @author nichind
 */

// Main Effects class
class EffectsSystem {
  constructor(globalConfig = {}) {
    // Core state
    this.elements = new Map();        // Stores all tracked elements
    this.observers = new Map();       // Stores IntersectionObserver instances
    this.animations = new Map();      // Stores active animations
    this.effectRegistry = {};         // Stores effect definitions
    
    // Default configuration
    this.config = {
      threshold: 0.2,                 // How much of element needs to be visible
      rootMargin: '0px',              // Margin around root element
      once: true,                     // Only animate once by default
      animationQuality: 'high',       // Animation quality (high, medium, low)
      debug: false,                   // Debug mode for logging
      useClasses: true,               // Use CSS classes instead of inline styles when possible
      defaultDuration: '0.5s',        // Default animation duration
      defaultDelay: '0s',             // Default animation delay
      defaultEasing: 'ease-out',      // Default animation easing
      detectTouch: true,              // Auto-detect touch devices
      reducedMotion: 'auto',          // Respect reduced motion preferences (auto, always, never)
      ...globalConfig                 // Override with user configuration
    };
    
    // Configure logger based on debug setting
    this.logger = new Logger(this.config.debug ? 'debug' : 'error');
    
    // Set up performance monitor if in debug mode
    this.perfMonitor = this.config.debug ? new PerformanceMonitor() : null;
    
    // Register built-in effects
    this._registerBuiltInEffects();
    
    // Check for reduced motion preference
    this._checkReducedMotion();
    
    this.logger.info('Effects System initialized with configuration:', this.config);
  }

  /**
   * Initialize the system by finding and preparing elements
   */
  init() {
    try {
      // Find all elements with data-effect attribute
      const elements = document.querySelectorAll('[data-effect]');
      this.logger.info(`Found ${elements.length} elements with data-effect attribute`);
      
      if (this.perfMonitor) this.perfMonitor.start('init');
      
      // Process each element
      elements.forEach(element => {
        this.prepareElement(element);
      });
      
      if (this.perfMonitor) {
        this.perfMonitor.end('init');
        this.logger.debug(`Initialization completed in ${this.perfMonitor.getTime('init')}ms`);
      }
      
      // Set up global event listeners
      this._setupEventListeners();
      
      return this;
    } catch (error) {
      this.logger.error('Failed to initialize effects system:', error);
      return this;
    }
  }
  
  /**
   * Prepare an element for animation
   * @param {HTMLElement} element - Element to prepare
   * @returns {boolean} Success status
   */
  prepareElement(element) {
    try {
      if (!element) throw new Error('No element provided');
      
      // Parse effect configuration from data attributes
      const effectConfig = this._parseElementConfig(element);
      
      if (!effectConfig || !effectConfig.type) {
        this.logger.warn('Invalid effect configuration for element:', element);
        return false;
      }
      
      // Store the element configuration
      this.elements.set(element, effectConfig);
      
      // Set initial styles
      this._setInitialState(element, effectConfig);
      
      // Start observing the element
      this._observeElement(element, effectConfig);
      
      return true;
    } catch (error) {
      this.logger.error('Failed to prepare element:', error, element);
      return false;
    }
  }
  
  /**
   * Play an animation on a specific element
   * @param {HTMLElement|string} target - Element or selector
   * @param {Object} overrideConfig - Optional config to override element settings
   * @returns {Promise} Resolves when animation completes
   */
  play(target, overrideConfig = {}) {
    return new Promise((resolve, reject) => {
      try {
        // Handle string selectors
        const element = typeof target === 'string' 
          ? document.querySelector(target) 
          : target;
        
        if (!element) {
          this.logger.warn(`Element not found: ${target}`);
          return reject(new Error('Element not found'));
        }
        
        // Get stored config or parse it if not already stored
        let config = this.elements.get(element);
        
        if (!config) {
          config = this._parseElementConfig(element);
          if (config) {
            this.elements.set(element, config);
            this._setInitialState(element, config);
          }
        }
        
        if (!config) {
          return reject(new Error('Could not determine effect configuration'));
        }
        
        // Merge with override config
        const mergedConfig = {...config, ...overrideConfig};
        
        // Ensure we have the effect function
        const effectFn = this.effectRegistry[mergedConfig.type];
        
        if (!effectFn) {
          this.logger.error(`Unknown effect type: ${mergedConfig.type}`);
          return reject(new Error(`Unknown effect type: ${mergedConfig.type}`));
        }
        
        // Create animation context
        const context = {
          element,
          config: mergedConfig,
          startTime: performance.now(),
          active: true,
          onComplete: resolve
        };
        
        // Store animation context
        this.animations.set(element, context);
        
        // Dispatch start event
        this._dispatchEvent(element, 'effectstart', {
          type: mergedConfig.type,
          duration: mergedConfig.duration,
          delay: mergedConfig.delay
        });
        
        // If we're using RAF for this animation, start the loop
        if (mergedConfig.useRAF) {
          this._startRAFLoop();
        } else {
          // Otherwise use CSS transitions
          this._playCSSTransition(element, mergedConfig, resolve);
        }
        
        this.logger.debug(`Playing effect "${mergedConfig.type}" on element:`, element);
      } catch (error) {
        this.logger.error('Failed to play animation:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Reset an element to its pre-animation state
   * @param {HTMLElement|string} target - Element or selector
   * @returns {boolean} Success status
   */
  reset(target) {
    try {
      // Handle string selectors
      const element = typeof target === 'string' 
        ? document.querySelector(target) 
        : target;
      
      if (!element) {
        this.logger.warn(`Element not found: ${target}`);
        return false;
      }
      
      // Get configuration
      const config = this.elements.get(element) || this._parseElementConfig(element);
      
      if (!config) {
        this.logger.warn('No configuration found for element:', element);
        return false;
      }
      
      // Remove active animation if any
      if (this.animations.has(element)) {
        const animation = this.animations.get(element);
        animation.active = false;
        this.animations.delete(element);
      }
      
      // Temporarily disable transitions
      const originalTransition = element.style.transition;
      element.style.transition = 'none';
      
      // Apply initial state
      this._setInitialState(element, config);
      
      // Force reflow
      void element.offsetWidth;
      
      // Restore transition
      setTimeout(() => {
        element.style.transition = originalTransition;
      }, 20);
      
      // Dispatch reset event
      this._dispatchEvent(element, 'effectreset', {
        type: config.type
      });
      
      return true;
    } catch (error) {
      this.logger.error('Failed to reset element:', error);
      return false;
    }
  }
  
  /**
   * Replay all animations matching a selector or all elements
   * @param {string} [selector] - Optional selector to filter elements
   * @returns {Promise} Resolves when all animations complete
   */
  replayAll(selector) {
    const elements = selector 
      ? document.querySelectorAll(`${selector}[data-effect]`)
      : document.querySelectorAll('[data-effect]');
    
    this.logger.info(`Replaying animations for ${elements.length} elements`);
    
    const promises = [];
    
    elements.forEach(element => {
      // Reset the element
      this.reset(element);
      
      // Small delay to ensure reset completes
      const promise = new Promise(resolve => {
        setTimeout(() => {
          this.play(element).then(resolve).catch(err => {
            this.logger.error('Error replaying animation:', err);
            resolve(); // Resolve anyway to not block other animations
          });
        }, 50);
      });
      
      promises.push(promise);
    });
    
    return Promise.all(promises);
  }
  
  /**
   * Register a custom effect
   * @param {string} name - Effect name
   * @param {Object} effectDefinition - Effect implementation and metadata
   * @returns {boolean} Success status
   */
  registerEffect(name, effectDefinition) {
    try {
      if (!name || typeof name !== 'string') {
        throw new Error('Effect name must be a non-empty string');
      }
      
      if (!effectDefinition || typeof effectDefinition.animate !== 'function') {
        throw new Error('Effect definition must include an animate function');
      }
      
      this.effectRegistry[name] = {
        initialState: effectDefinition.initialState || (() => {}),
        animate: effectDefinition.animate,
        useRAF: effectDefinition.useRAF === true,
        metadata: {
          name,
          description: effectDefinition.description || '',
          params: effectDefinition.params || [],
          author: effectDefinition.author || 'unknown',
          version: effectDefinition.version || '1.0.0'
        }
      };
      
      this.logger.info(`Registered effect: ${name}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to register effect "${name}":`, error);
      return false;
    }
  }
  
  /**
   * Get list of available effects
   * @returns {Array} List of effect names and metadata
   */
  getAvailableEffects() {
    return Object.keys(this.effectRegistry).map(name => {
      const effect = this.effectRegistry[name];
      return {
        name,
        ...effect.metadata
      };
    });
  }
  
  /**
   * Update global configuration
   * @param {Object} newConfig - New configuration options
   * @returns {Object} Updated configuration
   */
  updateConfig(newConfig) {
    if (!newConfig || typeof newConfig !== 'object') {
      this.logger.warn('Invalid configuration object');
      return this.config;
    }
    
    this.config = {
      ...this.config,
      ...newConfig
    };
    
    // Update logger level if debug setting changed
    if (newConfig.hasOwnProperty('debug')) {
      this.logger.setLevel(newConfig.debug ? 'debug' : 'error');
    }
    
    // Check for reduced motion preference changes
    if (newConfig.hasOwnProperty('reducedMotion')) {
      this._checkReducedMotion();
    }
    
    this.logger.info('Configuration updated:', this.config);
    return this.config;
  }
  
  /**
   * Clean up resources used by the effects system
   */
  destroy() {
    try {
      // Disconnect all observers
      this.observers.forEach(observer => {
        observer.disconnect();
      });
      
      // Clear all animation loops
      this.animations.forEach(animation => {
        animation.active = false;
      });
      
      // Clear all maps
      this.elements.clear();
      this.observers.clear();
      this.animations.clear();
      
      // Cancel any pending RAF
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      
      // Remove event listeners
      window.removeEventListener('resize', this._boundResizeHandler);
      
      this.logger.info('Effects system destroyed');
    } catch (error) {
      this.logger.error('Error during cleanup:', error);
    }
  }
  
  /* ==================== PRIVATE METHODS ==================== */
  
  /**
   * Set up required event listeners
   * @private
   */
  _setupEventListeners() {
    // Throttled resize handler
    this._boundResizeHandler = throttle(() => {
      if (this.config.debug) this.logger.debug('Window resized - updating effects');
      
      // Reset and replay all animations on window resize
      // Can be optimized to only handle affected elements
      this.replayAll();
    }, 250);
    
    window.addEventListener('resize', this._boundResizeHandler);
  }
  
  /**
   * Register all built-in effect types
   * @private
   */
  _registerBuiltInEffects() {
    // fadeIn effect
    this.registerEffect('fadeIn', {
      description: 'Simple fade in animation',
      initialState: (element) => {
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `opacity ${duration} ${easing} ${delay}`;
        element.style.opacity = '1';
      }
    });
    
    // slideUp effect
    this.registerEffect('slideUp', {
      description: 'Element slides up into view',
      initialState: (element) => {
        element.style.transform = 'translateY(40px)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.transform = 'translateY(0)';
        element.style.opacity = '1';
      }
    });
    
    // slideDown effect
    this.registerEffect('slideDown', {
      description: 'Element slides down into view',
      initialState: (element) => {
        element.style.transform = 'translateY(-40px)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.transform = 'translateY(0)';
        element.style.opacity = '1';
      }
    });
    
    // slideLeft effect
    this.registerEffect('slideLeft', {
      description: 'Element slides in from the left',
      initialState: (element) => {
        element.style.transform = 'translateX(-40px)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.transform = 'translateX(0)';
        element.style.opacity = '1';
      }
    });
    
    // slideRight effect
    this.registerEffect('slideRight', {
      description: 'Element slides in from the right',
      initialState: (element) => {
        element.style.transform = 'translateX(40px)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.transform = 'translateX(0)';
        element.style.opacity = '1';
      }
    });
    
    // scaleUp effect
    this.registerEffect('scaleUp', {
      description: 'Element scales up into view',
      initialState: (element) => {
        element.style.transform = 'scale(0.8)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.transform = 'scale(1)';
        element.style.opacity = '1';
      }
    });
    
    // zoomIn effect (alias for scaleUp with different initial scale)
    this.registerEffect('zoomIn', {
      description: 'Element zooms in from small size',
      initialState: (element) => {
        element.style.transform = 'scale(0.75)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.transform = 'scale(1)';
        element.style.opacity = '1';
      }
    });
    
    // blurIn effect
    this.registerEffect('blurIn', {
      description: 'Element fades in with blur effect',
      initialState: (element) => {
        element.style.filter = 'blur(10px)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `filter ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.filter = 'blur(0px)';
        element.style.opacity = '1';
      }
    });
    
    // rotateIn effect
    this.registerEffect('rotateIn', {
      description: 'Element rotates into view',
      initialState: (element) => {
        element.style.transform = 'rotate(-90deg)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.transform = 'rotate(0deg)';
        element.style.opacity = '1';
      }
    });
    
    // flipIn effect
    this.registerEffect('flipIn', {
      description: 'Element flips into view',
      initialState: (element) => {
        element.style.transform = 'rotateY(90deg)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.transform = 'rotateY(0deg)';
        element.style.opacity = '1';
      }
    });
    
    // slideUpWords effect (uses RAF for per-word animation)
    this.registerEffect('slideUpWords', {
      description: 'Text appears word by word',
      useRAF: true,
      initialState: (element) => {
        // Store original content if not already stored
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        // Parse content into words
        const content = element.dataset.originalContent;
        const words = this._parseContentIntoWords(content);
        
        // Replace content with wrapped words
        element.innerHTML = words.map(word => {
          if (word.type === 'space') {
            return word.content;
          } else {
            return `<span class="effect-word" style="display:inline-block; transform:translateY(30px) scale(0.8) rotateX(15deg); opacity:0; filter:blur(2px);">${word.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        // Get all word spans
        const words = element.querySelectorAll('.effect-word');
        
        // Calculate timing
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 120; // Slightly longer stagger for smoother effect
        
        // Calculate total animation duration including staggered words
        const totalDuration = delayMs + durationMs + ((words.length - 1) * staggerMs);
        
        // Smooth cubic-bezier easing for natural motion
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
        const easeOutQuart = t => 1 - Math.pow(1 - t, 4);
        
        // Check if all words have completed
        let allWordsComplete = true;
        
        words.forEach((word, index) => {
          // Stagger words by index
          const wordDelay = delayMs + (index * staggerMs);
          const wordProgress = Math.max(0, Math.min(1, (progress * totalDuration - wordDelay) / durationMs));
          
          if (wordProgress < 1) {
            allWordsComplete = false;
          }
          
          // Apply animation for this frame with smooth sub-pixel precision
          if (wordProgress > 0) {
            // Use different easing for different properties for more natural feel
            const translateEased = easeOutQuart(wordProgress);
            const opacityEased = easeOutCubic(wordProgress);
            const scaleEased = easeOutCubic(wordProgress);
            
            // Smooth transforms with sub-pixel precision
            const translateY = 30 * (1 - translateEased);
            const scale = 0.8 + (scaleEased * 0.2);
            const rotateX = 15 * (1 - translateEased);
            const blur = 2 * (1 - opacityEased);
            
            // Add slight momentum effect for the last 20% of animation
            let momentum = 0;
            if (wordProgress > 0.8) {
              const momentumProgress = (wordProgress - 0.8) / 0.2;
              momentum = Math.sin(momentumProgress * Math.PI) * 2;
            }
            
            word.style.transform = `translateY(${translateY - momentum}px) scale(${scale}) rotateX(${rotateX}deg)`;
            word.style.opacity = opacityEased.toString();
            word.style.filter = `blur(${blur}px)`;
          }
        });
        
        // Animation is complete only when all words have finished
        return allWordsComplete;
      }
    });
    
    // slideUpLetters effect (uses RAF for per-letter animation)
    this.registerEffect('slideUpLetters', {
      description: 'Text appears letter by letter',
      useRAF: true,
      initialState: (element) => {
        // Store original content if not already stored
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        // Parse content into letters
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        // Replace content with wrapped letters
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="effect-letter" style="display:inline-block; transform:translateY(25px) scale(0.7) rotateX(20deg); opacity:0; filter:blur(1.5px);">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        // Get all letter spans
        const letters = element.querySelectorAll('.effect-letter');
        
        // Calculate timing
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 40; // Slightly longer stagger for smoother effect
        
        // Calculate total animation duration including staggered letters
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        
        // Multiple easing functions for layered animation
        const easeOutExpo = t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
        const easeOutQuint = t => 1 - Math.pow(1 - t, 5);
        
        // Check if all letters have completed
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          // Stagger letters by index
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          // Apply animation for this frame with layered easing
          if (letterProgress > 0) {
            // Different easing for different properties creates more natural motion
            const translateEased = easeOutExpo(letterProgress);
            const scaleEased = easeOutCubic(letterProgress);
            const opacityEased = easeOutQuint(letterProgress);
            
            // Smooth transforms with floating-point precision
            const translateY = 25 * (1 - translateEased);
            const scale = 0.7 + (scaleEased * 0.3);
            const rotateX = 20 * (1 - translateEased);
            const blur = 1.5 * (1 - opacityEased);
            
            // Add subtle wave motion for organic feel
            const waveOffset = Math.sin((letterProgress * Math.PI * 2) + (index * 0.2)) * 1.5 * (1 - letterProgress);
            
            // Add gentle overshoot for the last 10% of animation
            let overshoot = 0;
            if (letterProgress > 0.9) {
              const overshootProgress = (letterProgress - 0.9) / 0.1;
              overshoot = Math.sin(overshootProgress * Math.PI) * 1.5;
            }
            
            letter.style.transform = `translateY(${translateY + waveOffset - overshoot}px) scale(${scale}) rotateX(${rotateX}deg)`;
            letter.style.opacity = opacityEased.toString();
            letter.style.filter = `blur(${blur}px)`;
          }
        });
        
        // Animation is complete only when all letters have finished
        return allLettersComplete;
      }
    });
    
    // textType effect (types text character by character)
    this.registerEffect('textType', {
      description: 'Types text character by character',
      useRAF: true,
      initialState: (element) => {
        // Store original content if not already stored
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        // Parse the content
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${element.dataset.originalContent}</div>`, 'text/html');
        const serializedNodes = JSON.stringify(this._serializeNodes(doc.querySelector('div').childNodes));
        element.dataset.parsedContent = serializedNodes;
        
        // Create a placeholder with the same dimensions as the final text
        // First, create a hidden clone to measure the final size
        const placeholder = element.cloneNode(true);
        placeholder.style.visibility = 'hidden';
        placeholder.style.position = 'absolute';
        placeholder.style.top = '-9999px';
        placeholder.style.left = '-9999px';
        placeholder.style.width = 'auto';
        placeholder.style.height = 'auto';
        placeholder.style.whiteSpace = 'pre-wrap'; // Preserve whitespace
        document.body.appendChild(placeholder);
        
        // Get final dimensions
        const rect = placeholder.getBoundingClientRect();
        document.body.removeChild(placeholder);
        
        // Set the element to empty but maintain dimensions
        if (!element.style.minWidth) {
          element.style.minWidth = `${rect.width}px`;
        }
        if (!element.style.minHeight) {
          element.style.minHeight = `${rect.height}px`;
        }
        
        // Prepare the element for typing
        element.innerHTML = '';
        element.style.opacity = '1';
      },
      animate: (element, { duration, delay }, progress) => {
        // Calculate timing
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        
        // Adjust progress for delay
        const adjustedProgress = Math.max(0, (progress * (durationMs + delayMs) - delayMs) / durationMs);
        
        if (adjustedProgress <= 0) return false;
        
        const nodes = JSON.parse(element.dataset.parsedContent);
        
        // Calculate text length for progress calculation
        if (!element.dataset.textLength) {
          let textLength = 0;
          const countText = (nodes) => {
            nodes.forEach(node => {
              if (node.type === 'text') {
                textLength += node.content.length;
              } else if (node.type === 'element' && node.children) {
                countText(node.children);
              }
            });
          };
          countText(nodes);
          element.dataset.textLength = textLength.toString();
        }
        
        const textLength = parseInt(element.dataset.textLength);
        const charsToShow = Math.floor(adjustedProgress * textLength);
        
        // Reset content
        element.innerHTML = '';
        
        // Rebuild with visible characters
        let charsShown = 0;
        const buildNodes = (nodes, parent = element) => {
          nodes.forEach(node => {
            if (node.type === 'text') {
              if (node.content.length > 0) {
                // Create a wrapper span for the text
                const span = document.createElement('span');
                span.style.whiteSpace = 'pre-wrap'; // Preserve whitespace
                
                // Add visible characters
                let visibleText = '';
                let hiddenText = '';
                
                for (let i = 0; i < node.content.length; i++) {
                  if (charsShown < charsToShow) {
                    visibleText += node.content[i];
                    charsShown++;
                  } else {
                    hiddenText += node.content[i];
                  }
                }
                
                // Add visible text
                if (visibleText) {
                  const visibleSpan = document.createElement('span');
                  visibleSpan.textContent = visibleText;
                  span.appendChild(visibleSpan);
                }
                
                // Add hidden text (transparent but taking up space)
                if (hiddenText) {
                  const hiddenSpan = document.createElement('span');
                  hiddenSpan.textContent = hiddenText;
                  hiddenSpan.style.color = 'transparent';
                  hiddenSpan.style.userSelect = 'none';
                  hiddenSpan.setAttribute('aria-hidden', 'true');
                  span.appendChild(hiddenSpan);
                }
                
                parent.appendChild(span);
              }
            } else if (node.type === 'element') {
              const el = document.createElement(node.tag);
              
              // Add attributes
              if (node.attributes) {
                Object.keys(node.attributes).forEach(key => {
                  el.setAttribute(key, node.attributes[key]);
                });
              }
              
              // Process children
              if (node.children && node.children.length > 0) {
                buildNodes(node.children, el);
              }
              
              // Only append if it has content or is self-closing
              if (el.childNodes.length > 0 || this._isSelfClosingTag(node.tag)) {
                parent.appendChild(el);
              }
            }
          });
        };
        
        buildNodes(nodes);
        
        // Animation is complete when all characters are shown
        return adjustedProgress >= 1;
      }
    });

    // 3D flip effect
    this.registerEffect('flip3D', {
      description: '3D flip animation',
      initialState: (element) => {
        element.style.transform = 'perspective(800px) rotateY(90deg)';
        element.style.opacity = '0';
        element.style.transformStyle = 'preserve-3d';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} ${easing} ${delay}, opacity ${duration} ${easing} ${delay}`;
        element.style.transform = 'perspective(800px) rotateY(0deg)';
        element.style.opacity = '1';
      }
    });

    // Staggered fade animation for child elements
    this.registerEffect('staggerChildren', {
      description: 'Staggered animation of child elements',
      useRAF: true,
      initialState: (element) => {
        // Get the target child selector
        const childSelector = element.dataset.childSelector || '*';
        
        // Find children
        const children = element.querySelectorAll(childSelector);
        
        // Set initial state for each child
        children.forEach(child => {
          child.style.opacity = '0';
          child.style.transform = 'translateY(20px)';
        });
        
        // Store children count
        element.dataset.childrenCount = children.length.toString();
      },
      animate: (element, { duration, delay, staggerAmount = '0.1s' }, progress) => {
        // Get child elements
        const childSelector = element.dataset.childSelector || '*';
        const children = element.querySelectorAll(childSelector);
        
        // Calculate timing
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = this._convertTimeToMs(staggerAmount);
        const totalDuration = delayMs + durationMs + (children.length - 1) * staggerMs;
        
        // Animation timing function
        const easeOutQuad = t => t * (2 - t);
        
        // Animate each child
        children.forEach((child, index) => {
          const childDelay = delayMs + (index * staggerMs);
          const childProgress = Math.max(0, Math.min(1, (progress * totalDuration - childDelay) / durationMs));
          
          if (childProgress > 0) {
            const eased = easeOutQuad(childProgress);
            child.style.opacity = eased.toString();
            child.style.transform = `translateY(${(1 - eased) * 20}px)`;
          }
        });
        
        // Animation is complete when all children are processed
        return progress >= 1;
      }
    });
    
    // Reveal effect (directional reveal)
    this.registerEffect('reveal', {
      description: 'Directional reveal with clip-path',
      initialState: (element) => {
        // Get direction parameter (left, right, top, bottom)
        const direction = element.dataset.direction || 'left';
        
        // Set initial clip path based on direction
        switch(direction) {
          case 'left':
            element.style.clipPath = 'inset(0 100% 0 0)';
            break;
          case 'right':
            element.style.clipPath = 'inset(0 0 0 100%)';
            break;
          case 'top':
            element.style.clipPath = 'inset(100% 0 0 0)';
            break;
          case 'bottom':
            element.style.clipPath = 'inset(0 0 100% 0)';
            break;
          default:
            element.style.clipPath = 'inset(0 100% 0 0)';
        }
        
        element.style.opacity = '1';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `clip-path ${duration} ${easing} ${delay}`;
        element.style.clipPath = 'inset(0 0 0 0)';
      }
    });
    
    // bounce effect
    this.registerEffect('bounce', {
      description: 'Bouncy entrance animation',
      initialState: (element) => {
        element.style.transform = 'scale(0.3)';
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `transform ${duration} cubic-bezier(0.175, 0.885, 0.32, 1.275) ${delay}, opacity ${duration} ease ${delay}`;
        element.style.transform = 'scale(1)';
        element.style.opacity = '1';
      }
    });

    // shake effect
    this.registerEffect('shake', {
      description: 'Shake/vibration animation',
      useRAF: true,
      initialState: (element) => {
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay }, progress) => {
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        
        // Adjust progress for delay
        const adjustedProgress = Math.max(0, (progress * (durationMs + delayMs) - delayMs) / durationMs);
        
        if (adjustedProgress <= 0) return false;
        
        // Apply shake effect
        if (adjustedProgress < 1) {
          const intensity = Math.sin(adjustedProgress * Math.PI) * 10;
          const offsetX = Math.sin(adjustedProgress * 30) * intensity;
          element.style.transform = `translateX(${offsetX}px)`;
          element.style.opacity = '1';
        } else {
          element.style.transform = 'translateX(0)';
          element.style.opacity = '1';
        }
        
        return adjustedProgress >= 1;
      }
    });

    // svgDraw effect for drawing SVG paths
    this.registerEffect('svgDraw', {
      description: 'Progressively draws SVG paths',
      initialState: (element) => {
        // Find all path, line, circle, rect, polygon, and polyline elements
        const paths = element.querySelectorAll('path, line, circle, rect, polygon, polyline');
        
        paths.forEach(path => {
          // Get path length
          let length = 0;
          if (path.getTotalLength) {
            length = path.getTotalLength();
          } else {
            // Fallback for elements without getTotalLength
            const box = path.getBBox();
            length = (box.width + box.height) * 2;
          }
          
          // Store original length
          path.dataset.pathLength = length;
          
          // Set initial state
          path.style.strokeDasharray = length;
          path.style.strokeDashoffset = length;
        });
        
        element.style.opacity = '1';
      },
      animate: (element, { duration, delay, easing }) => {
        const paths = element.querySelectorAll('path, line, circle, rect, polygon, polyline');
        
        paths.forEach((path, index) => {
          // Add stagger delay for each path
          const pathDelay = `calc(${delay} + ${index * 0.1}s)`;
          
          path.style.transition = `stroke-dashoffset ${duration} ${easing} ${pathDelay}`;
          path.style.strokeDashoffset = '0';
        });
      }
    });

    // ripple effect
    this.registerEffect('ripple', {
      description: 'Ripple/wave emanating from center',
      useRAF: true,
      initialState: (element) => {
        // Create ripple container if it doesn't exist
        if (!element.querySelector('.ripple-container')) {
          const container = document.createElement('div');
          container.className = 'ripple-container';
          container.style.position = 'absolute';
          container.style.top = '0';
          container.style.left = '0';
          container.style.width = '100%';
          container.style.height = '100%';
          container.style.overflow = 'hidden';
          container.style.pointerEvents = 'none';
          
          // Make parent relative if not already
          if (getComputedStyle(element).position === 'static') {
            element.style.position = 'relative';
          }
          
          element.appendChild(container);
        }
        
        element.style.opacity = '1';
      },
      animate: (element, { duration, delay }, progress) => {
        const container = element.querySelector('.ripple-container');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        
        // Adjust progress for delay
        const adjustedProgress = Math.max(0, (progress * (durationMs + delayMs) - delayMs) / durationMs);
        
        if (adjustedProgress <= 0) return false;
        
        // Create ripple on first frame
        if (adjustedProgress > 0 && !container.querySelector('.ripple')) {
          const ripple = document.createElement('div');
          ripple.className = 'ripple';
          
          // Get container dimensions
          const rect = container.getBoundingClientRect();
          const size = Math.max(rect.width, rect.height) * 2.5;
          
          // Style the ripple
          ripple.style.position = 'absolute';
          ripple.style.top = '50%';
          ripple.style.left = '50%';
          ripple.style.width = `${size}px`;
          ripple.style.height = `${size}px`;
          ripple.style.transform = 'translate(-50%, -50%) scale(0)';
          ripple.style.borderRadius = '50%';
          ripple.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
          
          container.appendChild(ripple);
        }
        
        // Animate the ripple
        const ripple = container.querySelector('.ripple');
        if (ripple) {
          // Scale from 0 to 1
          const scale = adjustedProgress;
          // Fade out as we approach the end
          const opacity = Math.max(0, 1 - adjustedProgress);
          
          ripple.style.transform = `translate(-50%, -50%) scale(${scale})`;
          ripple.style.opacity = opacity.toString();
        }
        
        // Clean up when done
        if (adjustedProgress >= 1) {
          setTimeout(() => {
            if (container && container.parentNode === element) {
              element.removeChild(container);
            }
          }, 100);
          return true;
        }
        
        return false;
      }
    });

    // parallax effect
    this.registerEffect('parallax', {
      description: 'Simple parallax scrolling effect',
      initialState: (element) => {
        // Store original transform
        element.dataset.originalTransform = element.style.transform || 'none';
        
        // Set up scroll listener for this element
        if (!window._parallaxElements) {
          window._parallaxElements = new Set();
          
          // Add scroll listener once
          if (!window._parallaxScrollHandler) {
            window._parallaxScrollHandler = () => {
              window._parallaxElements.forEach(el => {
                if (!el.isConnected) {
                  window._parallaxElements.delete(el);
                  return;
                }
                
                const rect = el.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                
                // Calculate how far the element is through the viewport
                const elementProgress = 1 - (rect.top + rect.height / 2) / (viewportHeight + rect.height);
                
                // Get parallax amount from data attribute or default
                const amount = parseFloat(el.dataset.parallaxAmount || '0.2');
                
                // Apply transform
                const shift = (elementProgress - 0.5) * amount * 100;
                const originalTransform = el.dataset.originalTransform;
                
                el.style.transform = originalTransform !== 'none' 
                  ? `${originalTransform} translateY(${shift}px)`
                  : `translateY(${shift}px)`;
              });
            };
            
            window.addEventListener('scroll', window._parallaxScrollHandler, { passive: true });
          }
        }
        
        // Add this element to tracked set
        window._parallaxElements.add(element);
        
        // Trigger once to set initial position
        setTimeout(() => {
          if (window._parallaxScrollHandler) {
            window._parallaxScrollHandler();
          }
        }, 10);
      },
      animate: (element, { duration, delay, easing }) => {
        // This effect is controlled by scroll, so animate just handles
        // the fade-in aspect
        element.style.transition = `opacity ${duration} ${easing} ${delay}`;
        element.style.opacity = '1';
      }
    });

    // textGlitch effect
    this.registerEffect('textGlitch', {
      description: 'Glitchy text animation',
      useRAF: true,
      initialState: (element) => {
        // Store original text
        if (!element.dataset.originalText) {
          element.dataset.originalText = element.textContent;
        }
        
        element.style.opacity = '0';
      },
      animate: (element, { duration, delay }, progress) => {
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        
        // Adjust progress for delay
        const adjustedProgress = Math.max(0, (progress * (durationMs + delayMs) - delayMs) / durationMs);
        
        if (adjustedProgress <= 0) return false;
        
        // Show element
        element.style.opacity = '1';
        
        const originalText = element.dataset.originalText;
        
        // Glitch characters during the first 80% of the animation
        if (adjustedProgress < 0.8) {
          // Characters to use for glitch effect
          const glitchChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-=_+[]{}|;:,.<>?/';
          
          // Calculate how many characters should be revealed vs glitched
          const revealPoint = adjustedProgress * 1.25; // Complete text reveal at 80% progress
          let glitchedText = '';
          
          for (let i = 0; i < originalText.length; i++) {
            // Character position progress (0-1)
            const charProgress = i / originalText.length;
            
            if (charProgress < revealPoint) {
              // This character should be revealed
              glitchedText += originalText[i];
            } else {
              // This character should be glitched
              const randomChar = glitchChars[Math.floor(Math.random() * glitchChars.length)];
              glitchedText += randomChar;
            }
          }
          
          element.textContent = glitchedText;
        } else {
          // Animation is in final stage, show original text
          element.textContent = originalText;
        }
        
        return adjustedProgress >= 1;
      }
    });

    // floatingElement effect
    this.registerEffect('floating', {
      description: 'Subtle floating/hovering animation',
      initialState: (element) => {
        element.style.opacity = '0';
        
        // Store original transform
        element.dataset.originalTransform = element.style.transform || 'none';
      },
      animate: (element, { duration, delay, easing }) => {
        // Fade in the element
        element.style.transition = `opacity ${duration} ${easing} ${delay}`;
        element.style.opacity = '1';
        
        // Get float amount from data attribute or use default
        const floatAmount = element.dataset.floatAmount || '10px';
        const floatDuration = element.dataset.floatDuration || '3s';
        
        // Apply floating animation with CSS
        const originalTransform = element.dataset.originalTransform;
        
        // Add animation keyframes if they don't exist yet
        if (!document.querySelector('#floating-keyframes')) {
          const style = document.createElement('style');
          style.id = 'floating-keyframes';
          style.textContent = `
            @keyframes floating {
              0% { transform: translate(0, 0); }
              50% { transform: translate(0, ${floatAmount}); }
              100% { transform: translate(0, 0); }
            }
          `;
          document.head.appendChild(style);
        }
        
        // Apply animation
        setTimeout(() => {
          element.style.animation = `floating ${floatDuration} ease-in-out infinite`;
        }, this._convertTimeToMs(delay) + this._convertTimeToMs(duration));
      }
    });

    // gradientText effect
    this.registerEffect('gradientText', {
      description: 'Animated gradient text effect',
      initialState: (element) => {
        element.style.opacity = '0';
        
        // Get gradient colors from data attributes or use defaults
        const color1 = element.dataset.gradientColor1 || '#ff8a00';
        const color2 = element.dataset.gradientColor2 || '#e52e71';
        const color3 = element.dataset.gradientColor3 || '#0066ff';
        
        // Create a unique ID for this element's gradient
        const id = 'gradient-' + Math.random().toString(36).substr(2, 9);
        element.dataset.gradientId = id;
        
        // Add the gradient keyframes
        if (!document.querySelector(`#${id}-keyframes`)) {
          const style = document.createElement('style');
          style.id = `${id}-keyframes`;
          style.textContent = `
            @keyframes ${id}-gradient {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
          `;
          document.head.appendChild(style);
        }
        
        // Apply gradient styling
        element.style.background = `linear-gradient(90deg, ${color1}, ${color2}, ${color3}, ${color1})`;
        element.style.backgroundSize = '300% 100%';
        element.style.webkitBackgroundClip = 'text';
        element.style.backgroundClip = 'text';
        element.style.webkitTextFillColor = 'transparent';
        element.style.textFillColor = 'transparent';
      },
      animate: (element, { duration, delay, easing }) => {
        // Fade in
        element.style.transition = `opacity ${duration} ${easing} ${delay}`;
        element.style.opacity = '1';
        
        // Get gradient animation duration
        const gradientDuration = element.dataset.gradientDuration || '3s';
        const id = element.dataset.gradientId;
        
        // Apply gradient animation after fade in
        setTimeout(() => {
          element.style.animation = `${id}-gradient ${gradientDuration} ease infinite`;
        }, this._convertTimeToMs(delay) + this._convertTimeToMs(duration));
      }
    });

    // 3D Card effect - tilts element based on mouse position within radius
    this.registerEffect('tiltCard', {
      description: '3D tilt effect based on mouse proximity',
      initialState: (element) => {
        element.style.opacity = '0';
        element.style.transform = 'perspective(1000px) rotateX(0) rotateY(0)';
        element.style.transformStyle = 'preserve-3d';
        element.style.transition = 'transform 0.1s ease-out';
        
        // Get tilt radius from data attribute or use default
        const tiltRadius = parseInt(element.dataset.tiltRadius || '50');
        const tiltAmount = parseInt(element.dataset.tiltAmount || '6');
        
        // Create global mouse tracking if it doesn't exist
        if (!window._globalMouseTracker) {
          window._globalMouseTracker = {
            x: 0,
            y: 0,
            elements: new Set(),
            isTracking: false
          };
          
          const updateMousePosition = (e) => {
            window._globalMouseTracker.x = e.clientX;
            window._globalMouseTracker.y = e.clientY;
            
            // Check all tracked elements for proximity
            window._globalMouseTracker.elements.forEach(trackedElement => {
              if (!trackedElement.isConnected) {
                window._globalMouseTracker.elements.delete(trackedElement);
                return;
              }
              
              const rect = trackedElement.getBoundingClientRect();
              
              // Calculate distance from mouse to nearest edge of element
              const mouseX = e.clientX;
              const mouseY = e.clientY;
              
              // Calculate closest point on the element's rectangle to the mouse
              const closestX = Math.max(rect.left, Math.min(mouseX, rect.right));
              const closestY = Math.max(rect.top, Math.min(mouseY, rect.bottom));
              
              // Calculate distance from mouse to closest point
              const dx = mouseX - closestX;
              const dy = mouseY - closestY;
              const distanceToEdge = Math.sqrt(dx * dx + dy * dy);
              
              const elementRadius = parseInt(trackedElement.dataset.tiltRadius || '50');
              const elementTiltAmount = parseInt(trackedElement.dataset.tiltAmount || '6');
              
              if (distanceToEdge <= elementRadius) {
                // Mouse is within tilt radius
                trackedElement.dataset.tiltActive = 'true';
                
                // Calculate tilt based on mouse position relative to element center
                const relativeX = e.clientX - rect.left;
                const relativeY = e.clientY - rect.top;
                
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                
                // Calculate intensity based on distance to edge (closer = stronger effect)
                const intensity = Math.max(0, 1 - (distanceToEdge / elementRadius));
                
                const rotateY = ((relativeX - centerX) / centerX) * elementTiltAmount * intensity;
                const rotateX = -((relativeY - centerY) / centerY) * elementTiltAmount * intensity;
                
                trackedElement.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
              } else {
                // Mouse is outside tilt radius
                if (trackedElement.dataset.tiltActive === 'true') {
                  trackedElement.dataset.tiltActive = 'false';
                  trackedElement.style.transition = 'transform 0.4s cubic-bezier(0.23, 1, 0.32, 1)';
                  trackedElement.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)';
                  
                  // Reset transition after animation
                  setTimeout(() => {
                    if (trackedElement.isConnected) {
                      trackedElement.style.transition = 'transform 0.1s ease-out';
                    }
                  }, 400);
                }
              }
            });
          };
          
          // Start global mouse tracking
          document.addEventListener('mousemove', updateMousePosition, { passive: true });
          window._globalMouseTracker.isTracking = true;
        }
        
        // Add this element to tracking set
        window._globalMouseTracker.elements.add(element);
        
        // Store cleanup function
        element._tiltCleanup = () => {
          if (window._globalMouseTracker) {
            window._globalMouseTracker.elements.delete(element);
          }
        };
        
        // Add visual debugging if debug mode is enabled
        if (this.config.debug) {
          const debugOverlay = document.createElement('div');
          debugOverlay.style.position = 'fixed';
          debugOverlay.style.border = '2px dashed rgba(255, 0, 0, 0.3)';
          debugOverlay.style.pointerEvents = 'none';
          debugOverlay.style.zIndex = '9999';
          debugOverlay.style.display = 'none';
          debugOverlay.className = 'tilt-debug-overlay';
          
          document.body.appendChild(debugOverlay);
          
          element._debugOverlay = debugOverlay;
          
          // Update debug overlay to show radius around element
          const updateDebugOverlay = () => {
            if (!element.isConnected) return;
            
            const rect = element.getBoundingClientRect();
            const radius = tiltRadius;
            
            // Create a rectangle that encompasses the element + radius
            const left = rect.left - radius;
            const top = rect.top - radius;
            const width = rect.width + (radius * 2);
            const height = rect.height + (radius * 2);
            
            debugOverlay.style.left = `${left}px`;
            debugOverlay.style.top = `${top}px`;
            debugOverlay.style.width = `${width}px`;
            debugOverlay.style.height = `${height}px`;
            debugOverlay.style.borderRadius = `${radius}px`;
            debugOverlay.style.display = 'block';
          };
          
          // Show debug overlay on element hover
          element.addEventListener('mouseenter', () => {
            updateDebugOverlay();
          });
          
          element.addEventListener('mouseleave', () => {
            debugOverlay.style.display = 'none';
          });
          
          // Update position on scroll/resize
          const updateDebugPosition = () => {
            if (debugOverlay.style.display !== 'none') {
              updateDebugOverlay();
            }
          };
          
          window.addEventListener('scroll', updateDebugPosition, { passive: true });
          window.addEventListener('resize', updateDebugPosition, { passive: true });
          
          element._debugCleanup = () => {
            if (debugOverlay && debugOverlay.parentNode) {
              debugOverlay.parentNode.removeChild(debugOverlay);
            }
            window.removeEventListener('scroll', updateDebugPosition);
            window.removeEventListener('resize', updateDebugPosition);
          };
        }
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `opacity ${duration} ${easing} ${delay}`;
        element.style.opacity = '1';
      }
    });

    // splitText effect (splits text into lines)
    this.registerEffect('splitLines', {
      description: 'Split text into lines with staggered animation',
      useRAF: true,
      initialState: (element) => {
        // Store original content if not already stored
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        // Get text content
        const text = element.dataset.originalContent;
        
        // Create a temporary element to split lines
        const temp = document.createElement('div');
        temp.innerHTML = text;
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.width = getComputedStyle(element).width;
        temp.style.fontSize = getComputedStyle(element).fontSize;
        temp.style.fontFamily = getComputedStyle(element).fontFamily;
        temp.style.lineHeight = getComputedStyle(element).lineHeight;
        temp.style.whiteSpace = getComputedStyle(element).whiteSpace;
        document.body.appendChild(temp);
        
        // Split into lines
        const lines = [];
        const words = temp.textContent.split(' ');
        let currentLine = '';
        let currentLineEl = document.createElement('div');
        
        words.forEach(word => {
          const testLine = currentLine + (currentLine ? ' ' : '') + word;
          currentLineEl.textContent = testLine;
          
          if (currentLineEl.offsetWidth > temp.offsetWidth && currentLine) {
            // Line is too long, push current line and start a new one
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        });
        
        // Add the last line
        if (currentLine) {
          lines.push(currentLine);
        }
        
        // Clean up temporary element
        document.body.removeChild(temp);
        
        // Replace content with wrapped lines
        element.innerHTML = lines.map(line => 
          `<div class="split-line" style="display:block; overflow:hidden;">
            <div class="line-inner" style="transform:translateY(100%); opacity:0;">
              ${line}
            </div>
          </div>`
        ).join('');
      },
      animate: (element, { duration, delay, easing }, progress) => {
        // Get all line elements
        const lines = element.querySelectorAll('.line-inner');
        
        // Calculate timing
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 120; // Stagger time per line in ms
        
        // Calculate total animation duration including staggered lines
        const totalDuration = delayMs + durationMs + ((lines.length - 1) * staggerMs);
        
        // Animation timing function (ease out)
        const easeOutQuad = t => t * (2 - t);
        
        // Check if all lines have completed
        let allLinesComplete = true;
        
        lines.forEach((line, index) => {
          // Stagger lines by index
          const lineDelay = delayMs + (index * staggerMs);
          const lineProgress = Math.max(0, Math.min(1, (progress * totalDuration - lineDelay) / durationMs));
          
          if (lineProgress < 1) {
            allLinesComplete = false;
          }
          
          // Apply animation for this frame
          const eased = lineProgress > 0 ? easeOutQuad(lineProgress) : 0;
          line.style.transform = `translateY(${(1 - eased) * 100}%)`;
          line.style.opacity = eased.toString();
        });
        
        // Animation is complete only when all lines have finished
        return allLinesComplete;
      }
    });

    // Text wave effect - letters wave in sequence
    this.registerEffect('textWave', {
      description: 'Letters appear in a wave motion',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="wave-letter" style="display:inline-block; transform:translateY(20px) scale(0.8); opacity:0;">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.wave-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const waveFreq = 0.3; // Wave frequency
        const staggerMs = 50;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            // Wave motion
            const waveOffset = Math.sin((letterProgress * Math.PI * 2) + (index * waveFreq)) * 10 * (1 - letterProgress);
            const scale = 0.8 + (letterProgress * 0.2);
            
            letter.style.transform = `translateY(${(1 - letterProgress) * 20 + waveOffset}px) scale(${scale})`;
            letter.style.opacity = letterProgress.toString();
          }
        });
        
        return allLettersComplete;
      }
    });

    // Text blur reveal
    this.registerEffect('textBlurReveal', {
      description: 'Text appears from blur with staggered timing',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const words = this._parseContentIntoWords(content);
        
        element.innerHTML = words.map(word => {
          if (word.type === 'space') {
            return word.content;
          } else {
            return `<span class="blur-word" style="display:inline-block; filter:blur(15px); opacity:0;">${word.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const words = element.querySelectorAll('.blur-word');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 80;
        
        const totalDuration = delayMs + durationMs + ((words.length - 1) * staggerMs);
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
        
        let allWordsComplete = true;
        
        words.forEach((word, index) => {
          const wordDelay = delayMs + (index * staggerMs);
          const wordProgress = Math.max(0, Math.min(1, (progress * totalDuration - wordDelay) / durationMs));
          
          if (wordProgress < 1) {
            allWordsComplete = false;
          }
          
          if (wordProgress > 0) {
            const eased = easeOutCubic(wordProgress);
            const blur = 15 * (1 - eased);
            
            word.style.filter = `blur(${blur}px)`;
            word.style.opacity = eased.toString();
          }
        });
        
        return allWordsComplete;
      }
    });

    // textMatrix effect
    this.registerEffect('textMatrix', {
      description: 'Matrix-style character reveal',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="matrix-letter" style="display:inline-block; opacity:0;">${letter.content}</span>`;
          }
        }).join('');
        
        // Store original characters
        element.querySelectorAll('.matrix-letter').forEach((span, index) => {
          span.dataset.original = span.textContent;
          span.dataset.index = index;
        });
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.matrix-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const matrixChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        const staggerMs = 60;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            letter.style.opacity = '1';
            
            // Show random characters for first 70% of animation
            if (letterProgress < 0.7) {
              const randomChar = matrixChars[Math.floor(Math.random() * matrixChars.length)];
              letter.textContent = randomChar;
              letter.style.color = '#00ff00';
            } else {
              // Reveal original character
              letter.textContent = letter.dataset.original;
              letter.style.color = '';
            }
          }
        });
        
        return allLettersComplete;
      }
    });

    // Text flip reveal
    this.registerEffect('textFlip', {
      description: 'Words flip into view with 3D rotation',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const words = this._parseContentIntoWords(content);
        
        element.innerHTML = words.map(word => {
          if (word.type === 'space') {
            return word.content;
          } else {
            return `<span class="flip-word" style="display:inline-block; transform:perspective(600px) rotateX(90deg); opacity:0; transform-style:preserve-3d;">${word.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const words = element.querySelectorAll('.flip-word');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 100;
        
        const totalDuration = delayMs + durationMs + ((words.length - 1) * staggerMs);
        const easeOutBack = t => {
          const c1 = 1.70158;
          const c3 = c1 + 1;
          return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        };
        
        let allWordsComplete = true;
        
        words.forEach((word, index) => {
          const wordDelay = delayMs + (index * staggerMs);
          const wordProgress = Math.max(0, Math.min(1, (progress * totalDuration - wordDelay) / durationMs));
          
          if (wordProgress < 1) {
            allWordsComplete = false;
          }
          
          if (wordProgress > 0) {
            const eased = easeOutBack(wordProgress);
            const rotation = 90 * (1 - eased);
            
            word.style.transform = `perspective(600px) rotateX(${rotation}deg)`;
            word.style.opacity = wordProgress.toString();
          }
        });
        
        return allWordsComplete;
      }
    });

    // Text scale reveal
    this.registerEffect('textScale', {
      description: 'Letters scale up from tiny to normal size',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="scale-letter" style="display:inline-block; transform:scale(0); opacity:0;">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.scale-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 40;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        const easeOutElastic = t => {
          const c4 = (2 * Math.PI) / 3;
          return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
        };
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            const eased = easeOutElastic(letterProgress);
            const scale = Math.max(0, eased);
            
            letter.style.transform = `scale(${scale})`;
            letter.style.opacity = letterProgress.toString();
          }
        });
        
        return allLettersComplete;
      }
    });

    // Text rainbow effect
    this.registerEffect('textRainbow', {
      description: 'Letters appear with cycling rainbow colors',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="rainbow-letter" style="display:inline-block; opacity:0; transform:translateY(20px);">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.rainbow-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 60;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        const easeOutQuad = t => t * (2 - t);
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            const eased = easeOutQuad(letterProgress);
            
            // Rainbow color calculation
            const hue = (index * 30 + progress * 360) % 360;
            const color = `hsl(${hue}, 80%, 60%)`;
            
            letter.style.transform = `translateY(${(1 - eased) * 20}px)`;
            letter.style.opacity = eased.toString();
            letter.style.color = color;
          }
        });
        
        return allLettersComplete;
      }
    });

    // morphIn effect - smooth morphing transition
    this.registerEffect('morphIn', {
      description: 'Element morphs into view with smooth scaling and opacity',
      initialState: (element) => {
        element.style.transform = 'scale(0.3) rotate(45deg)';
        element.style.opacity = '0';
        element.style.filter = 'blur(20px)';
      },
      animate: (element, { duration, delay, easing }) => {
        const customEasing = easing === 'ease-out' ? 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' : easing;
        element.style.transition = `all ${duration} ${customEasing} ${delay}`;
        element.style.transform = 'scale(1) rotate(0deg)';
        element.style.opacity = '1';
        element.style.filter = 'blur(0px)';
      }
    });

    // liquidFade effect - smooth liquid-like fade in
    this.registerEffect('liquidFade', {
      description: 'Liquid-like fade with subtle wave motion',
      useRAF: true,
      initialState: (element) => {
        element.style.opacity = '0';
        element.style.transform = 'scale(0.95)';
        element.style.filter = 'blur(5px)';
      },
      animate: (element, { duration, delay }, progress) => {
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        
        const adjustedProgress = Math.max(0, (progress * (durationMs + delayMs) - delayMs) / durationMs);
        
        if (adjustedProgress <= 0) return false;
        
        // Smooth easing function (ease-out-quart)
        const easeOutQuart = t => 1 - Math.pow(1 - t, 4);
        const eased = easeOutQuart(adjustedProgress);
        
        // Subtle wave motion
        const wave = Math.sin(adjustedProgress * Math.PI * 2) * 2 * (1 - adjustedProgress);
        
        element.style.opacity = eased.toString();
        element.style.transform = `scale(${0.95 + (eased * 0.05)}) translateY(${wave}px)`;
        element.style.filter = `blur(${5 * (1 - eased)}px)`;
        
        return adjustedProgress >= 1;
      }
    });

    // breathe effect - gentle breathing animation
    this.registerEffect('breathe', {
      description: 'Gentle breathing scale animation',
      initialState: (element) => {
        element.style.opacity = '0';
        element.style.transform = 'scale(0.8)';
      },
      animate: (element, { duration, delay, easing }) => {
        // Initial fade in
        element.style.transition = `opacity ${duration} ${easing} ${delay}`;
        element.style.opacity = '1';
        
        // Add breathing keyframes if they don't exist yet
        if (!document.querySelector('#breathe-keyframes')) {
          const style = document.createElement('style');
          style.id = 'breathe-keyframes';
          style.textContent = `
            @keyframes breathe {

              0%, 100% { transform: scale(1); }
              50% { transform: scale(1.05); }
            }
          `;
          document.head.appendChild(style);
        }
        
        // Apply breathing animation after fade in
        setTimeout(() => {
          element.style.animation = 'breathe 4s ease-in-out infinite';
        }, this._convertTimeToMs(delay) + this._convertTimeToMs(duration));
      }
    });

    // smoothBounce effect - very smooth bounce with custom easing
    this.registerEffect('smoothBounce', {
      description: 'Ultra-smooth bounce animation',
      useRAF: true,
      initialState: (element) => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(50px) scale(0.8)';
      },
      animate: (element, { duration, delay }, progress) => {
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        
        const adjustedProgress = Math.max(0, (progress * (durationMs + delayMs) - delayMs) / durationMs);
        
        if (adjustedProgress <= 0) return false;
        
        // Custom smooth bounce easing
        const smoothBounce = t => {
          if (t < 0.5) {
            return 2 * t * t;
          } else {
            const f = t - 0.5;
            return 0.5 + 2 * f * (1 - f);
          }
        };
        
        const eased = smoothBounce(adjustedProgress);
        const bounceHeight = Math.sin(adjustedProgress * Math.PI * 3) * 10 * (1 - adjustedProgress);
        
        element.style.opacity = adjustedProgress.toString();
        element.style.transform = `translateY(${(1 - eased) * 50 + bounceHeight}px) scale(${0.8 + (eased * 0.2)})`;
        
        return adjustedProgress >= 1;
      }
    });

    // elasticSlide effect - elastic slide with overshoot
    this.registerEffect('elasticSlide', {
      description: 'Elastic slide with smooth overshoot',
      useRAF: true,
      initialState: (element) => {
        const direction = element.dataset.slideDirection || 'left';
        let transform = '';
        
        switch(direction) {
          case 'left':
            transform = 'translateX(-100px)';
            break;
          case 'right':
            transform = 'translateX(100px)';
            break;
          case 'up':
            transform = 'translateY(-50px)';
            break;
          case 'down':
            transform = 'translateY(50px)';
            break;
          default:
            transform = 'translateX(-100px)';
        }
        
        element.style.opacity = '0';
        element.style.transform = transform;
      },
      animate: (element, { duration, delay }, progress) => {
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        
        const adjustedProgress = Math.max(0, (progress * (durationMs + delayMs) - delayMs) / durationMs);
        
        if (adjustedProgress <= 0) return false;
        
        // Elastic ease out function
        const elasticOut = t => {
          const p = 0.3;
          return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
        };
        
        const eased = adjustedProgress > 0.95 ? 1 : elasticOut(adjustedProgress);
        const direction = element.dataset.slideDirection || 'left';
        
        let transform = '';
        switch(direction) {
          case 'left':
            transform = `translateX(${(1 - eased) * -100}px)`;
            break;
          case 'right':
            transform = `translateX(${(1 - eased) * 100}px)`;
            break;
          case 'up':
            transform = `translateY(${(1 - eased) * -50}px)`;
            break;
          case 'down':
            transform = `translateY(${(1 - eased) * 50}px)`;
            break;
        }
        
        element.style.opacity = Math.min(1, adjustedProgress * 2).toString();
        element.style.transform = transform;
        
        return adjustedProgress >= 1;
      }
    });

    // smoothReveal effect - smooth clip-path reveal
    this.registerEffect('smoothReveal', {
      description: 'Smooth reveal with clip-path and scale',
      useRAF: true,
      initialState: (element) => {
        element.style.clipPath = 'circle(0% at 50% 50%)';
        element.style.transform = 'scale(1.1)';
        element.style.opacity = '0.8';
      },
      animate: (element, { duration, delay }, progress) => {
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        
        const adjustedProgress = Math.max(0, (progress * (durationMs + delayMs) - delayMs) / durationMs);
        
        if (adjustedProgress <= 0) return false;
        
        // Smooth ease out
        const easeOutExpo = t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
        const eased = easeOutExpo(adjustedProgress);
        
        const radius = eased * 150; // Maximum radius percentage
        const scale = 1.1 - (eased * 0.1); // Scale from 1.1 to 1
        const opacity = 0.8 + (eased * 0.2); // Opacity from 0.8 to 1
        
        element.style.clipPath = `circle(${radius}% at 50% 50%)`;
        element.style.transform = `scale(${scale})`;
        element.style.opacity = opacity.toString();
        
        return adjustedProgress >= 1;
      }
    });

    // glowIn effect - element appears with a glow
    this.registerEffect('glowIn', {
      description: 'Element fades in with a glowing effect',
      initialState: (element) => {
        element.style.opacity = '0';
        element.style.transform = 'scale(0.9)';
        element.style.filter = 'drop-shadow(0 0 0px rgba(79, 70, 229, 0))';
      },
      animate: (element, { duration, delay, easing }) => {
        element.style.transition = `all ${duration} ${easing} ${delay}`;
        element.style.opacity = '1';
        element.style.transform = 'scale(1)';
        element.style.filter = 'drop-shadow(0 0 20px rgba(79, 70, 229, 0.5))';
        
        // Remove glow after animation
        setTimeout(() => {
          element.style.transition = `filter 1s ease-out`;
          element.style.filter = 'drop-shadow(0 0 0px rgba(79, 70, 229, 0))';
        }, this._convertTimeToMs(delay) + this._convertTimeToMs(duration) + 500);
      }
    });

    // unfold effect - paper-like unfolding animation
    this.registerEffect('unfold', {
      description: 'Element unfolds like paper with 3D perspective',
      initialState: (element) => {
        element.style.transform = 'perspective(800px) rotateX(-90deg)';
        element.style.opacity = '0';
        element.style.transformOrigin = 'top center';
        element.style.transformStyle = 'preserve-3d';
      },
      animate: (element, { duration, delay, easing }) => {
        const customEasing = 'cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        element.style.transition = `all ${duration} ${customEasing} ${delay}`;
        element.style.transform = 'perspective(800px) rotateX(0deg)';
        element.style.opacity = '1';
      }
    });

    // textSlide - text slides in from different directions per word
    this.registerEffect('textSlide', {
      description: 'Words slide in from alternating directions',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const words = this._parseContentIntoWords(content);
        
        element.innerHTML = words.map((word, index) => {
          if (word.type === 'space') {
            return word.content;
          } else {
            const direction = index % 2 === 0 ? 'left' : 'right';
            const translateX = direction === 'left' ? '-100px' : '100px';
            return `<span class="slide-word" data-direction="${direction}" style="display:inline-block; transform:translateX(${translateX}); opacity:0;">${word.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const words = element.querySelectorAll('.slide-word');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 80;
        
        const totalDuration = delayMs + durationMs + ((words.length - 1) * staggerMs);
        const easeOutBack = t => {
          const c1 = 1.70158;
          const c3 = c1 + 1;
          return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        };
        
        let allWordsComplete = true;
        
        words.forEach((word, index) => {
          const wordDelay = delayMs + (index * staggerMs);
          const wordProgress = Math.max(0, Math.min(1, (progress * totalDuration - wordDelay) / durationMs));
          
          if (wordProgress < 1) {
            allWordsComplete = false;
          }
          
          if (wordProgress > 0) {
            const eased = easeOutBack(wordProgress);
            const direction = word.dataset.direction;
            const startX = direction === 'left' ? -100 : 100;
            
            word.style.transform = `translateX(${startX * (1 - eased)}px)`;
            word.style.opacity = wordProgress.toString();
          }
        });
        
        return allWordsComplete;
      }
    });

    // textNeon - neon glow text effect
    this.registerEffect('textNeon', {
      description: 'Text appears with neon glow effect',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="neon-letter" style="display:inline-block; opacity:0; text-shadow:none;">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.neon-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 50;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        
        // Get neon color from data attribute or use default
        const neonColor = element.dataset.neonColor || '#00ffff';
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            const intensity = Math.sin(letterProgress * Math.PI) * letterProgress;
            const shadowIntensity = intensity * 20;
            
            letter.style.opacity = letterProgress.toString();
            letter.style.textShadow = `
              0 0 5px ${neonColor},
              0 0 10px ${neonColor},
              0 0 ${shadowIntensity}px ${neonColor},
              0 0 ${shadowIntensity * 2}px ${neonColor}
            `;
            letter.style.color = neonColor;
          }
        });
        
        return allLettersComplete;
      }
    });

    // textSpiral - letters spiral into place
    this.registerEffect('textSpiral', {
      description: 'Letters spiral into their final position',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="spiral-letter" style="display:inline-block; transform:rotate(360deg) scale(0); opacity:0;">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.spiral-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 60;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        const easeOutElastic = t => {
          const c4 = (2 * Math.PI) / 3;
          return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
        };
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            const eased = easeOutElastic(letterProgress);
            const rotation = 360 * (1 - letterProgress);
            const scale = Math.max(0, eased);
            
            letter.style.transform = `rotate(${rotation}deg) scale(${scale})`;
            letter.style.opacity = letterProgress.toString();
          }
        });
        
        return allLettersComplete;
      }
    });

    // textShatter - text pieces shatter into place
    this.registerEffect('textShatter', {
      description: 'Letters shatter into view from random positions',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map((letter, index) => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            // Random starting position
            const randomX = (Math.random() - 0.5) * 200;
            const randomY = (Math.random() - 0.5) * 200;
            const randomRotate = (Math.random() - 0.5) * 720;
            
            return `<span class="shatter-letter" data-start-x="${randomX}" data-start-y="${randomY}" data-start-rotate="${randomRotate}" style="display:inline-block; transform:translate(${randomX}px, ${randomY}px) rotate(${randomRotate}deg) scale(0); opacity:0;">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.shatter-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 40;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            const eased = easeOutCubic(letterProgress);
            const startX = parseFloat(letter.dataset.startX);
            const startY = parseFloat(letter.dataset.startY);
            const startRotate = parseFloat(letter.dataset.startRotate);
            
            const currentX = startX * (1 - eased);
            const currentY = startY * (1 - eased);
            const currentRotate = startRotate * (1 - eased);
            const scale = Math.max(0, eased);
            
            letter.style.transform = `translate(${currentX}px, ${currentY}px) rotate(${currentRotate}deg) scale(${scale})`;
            letter.style.opacity = letterProgress.toString();
          }
        });
        
        return allLettersComplete;
      }
    });

    // textPulse - letters pulse with heartbeat rhythm
    this.registerEffect('textPulse', {
      description: 'Letters pulse into view with heartbeat rhythm',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="pulse-letter" style="display:inline-block; transform:scale(0); opacity:0;">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.pulse-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 70;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            // Create heartbeat pulse pattern
            const pulsePhase = letterProgress * Math.PI * 6;
            const heartbeat = Math.abs(Math.sin(pulsePhase)) * Math.sin(letterProgress * Math.PI);
            const baseScale = Math.min(letterProgress * 2, 1);
            const scale = baseScale + (heartbeat * 0.2);
            
            letter.style.transform = `scale(${scale})`;
            letter.style.opacity = Math.min(letterProgress * 1.5, 1).toString();
          }
        });
        
        return allLettersComplete;
      }
    });

    // textMorphChars - characters morph from random to correct
    this.registerEffect('textMorphChars', {
      description: 'Characters morph from random symbols to final text',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="morph-letter" data-final="${letter.content}" style="display:inline-block; opacity:0;">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.morph-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const morphChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
        const staggerMs = 50;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            letter.style.opacity = '1';
            
            // Morph through random characters for first 70% of animation
            if (letterProgress < 0.7) {
              const morphProgress = letterProgress / 0.7;
              // Show fewer random chars as we progress
              if (Math.random() > morphProgress) {
                const randomChar = morphChars[Math.floor(Math.random() * morphChars.length)];
                letter.textContent = randomChar;
              } else {
                letter.textContent = letter.dataset.final;
              }
            } else {
              // Show final character
              letter.textContent = letter.dataset.final;
            }
          }
        });
        
        return allLettersComplete;
      }
    });

    // textDropIn - letters drop in from above with bounce
    this.registerEffect('textDropIn', {
      description: 'Letters drop in from above with bouncy landing',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="drop-letter" style="display:inline-block; transform:translateY(-100px); opacity:0;">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.drop-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 45;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            // Simulate gravity with bounce
            const gravity = 1;
            const bounceHeight = -100;
            const bounce = Math.sin(letterProgress * Math.PI * 2) * 10 * (1 - letterProgress);
            
            // Ease out with bounce
            const easeProgress = letterProgress * letterProgress * (3 - 2 * letterProgress);
            const yPos = bounceHeight * (1 - easeProgress) + bounce;
            
            letter.style.transform = `translateY(${yPos}px)`;
            letter.style.opacity = letterProgress.toString();
          }
        });
        
        return allLettersComplete;
      }
    });

    // textZoomRotate - letters zoom and rotate into place
    this.registerEffect('textZoomRotate', {
      description: 'Letters zoom in with rotation effect',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map((letter, index) => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            const rotation = (index % 2 === 0) ? 180 : -180;
            return `<span class="zoom-rotate-letter" data-rotation="${rotation}" style="display:inline-block; transform:scale(0) rotate(${rotation}deg); opacity:0;">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.zoom-rotate-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 55;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        const easeOutBack = t => {
          const c1 = 1.70158;
          const c3 = c1 + 1;
          return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        };
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            const eased = easeOutBack(letterProgress);
            const startRotation = parseFloat(letter.dataset.rotation);
            const currentRotation = startRotation * (1 - letterProgress);
            const scale = Math.max(0, eased);
            
            letter.style.transform = `scale(${scale}) rotate(${currentRotation}deg)`;
            letter.style.opacity = letterProgress.toString();
          }
        });
        
        return allLettersComplete;
      }
    });

    // textSlowReveal - very slow, dramatic character reveal
    this.registerEffect('textSlowReveal', {
      description: 'Dramatic slow reveal of each character',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="slow-reveal-letter" style="display:inline-block; transform:scaleY(0) translateY(20px); opacity:0; filter:blur(5px);">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.slow-reveal-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 150; // Slower stagger for dramatic effect
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        const easeOutQuart = t => 1 - Math.pow(1 - t, 4);
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            const eased = easeOutQuart(letterProgress);
            const scaleY = eased;
            const translateY = 20 * (1 - eased);
            const blur = 5 * (1 - eased);
            
            letter.style.transform = `scaleY(${scaleY}) translateY(${translateY}px)`;
            letter.style.opacity = letterProgress.toString();
            letter.style.filter = `blur(${blur}px)`;
          }
        });
        
        return allLettersComplete;
      }
    });

    // textBlueAppear - text appears with animated blue color effect
    this.registerEffect('textBlueAppear', {
      description: 'Text appears with animated blue color effect',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="blue-appear-letter" style="display:inline-block; opacity:0; color:transparent; transform:translateY(10px) scale(0.8);">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const letters = element.querySelectorAll('.blue-appear-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 60;
        
        const totalDuration = delayMs + durationMs + ((letters.length - 1) * staggerMs);
        const easeOutBack = t => {
          const c1 = 1.70158;
          const c3 = c1 + 1;
          return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        };
        
        // Get blue shade from data attribute or use default
        const blueShade = element.dataset.blueShade || '#2563eb';
        
        let allLettersComplete = true;
        
        letters.forEach((letter, index) => {
          const letterDelay = delayMs + (index * staggerMs);
          const letterProgress = Math.max(0, Math.min(1, (progress * totalDuration - letterDelay) / durationMs));
          
          if (letterProgress < 1) {
            allLettersComplete = false;
          }
          
          if (letterProgress > 0) {
            const eased = easeOutBack(letterProgress);
            const scale = 0.8 + (eased * 0.2);
            const translateY = 10 * (1 - eased);
            
            // Animate blue color intensity
            const blueIntensity = Math.sin(letterProgress * Math.PI) * 0.3 + 0.7;
            const finalColor = this._adjustColorBrightness(blueShade, blueIntensity);
            
            letter.style.transform = `translateY(${translateY}px) scale(${scale})`;
            letter.style.opacity = letterProgress.toString();
            letter.style.color = finalColor;
            
            // Add subtle blue glow effect
            if (letterProgress > 0.5) {
              const glowIntensity = (letterProgress - 0.5) * 2;
              letter.style.textShadow = `0 0 ${glowIntensity * 8}px ${blueShade}40`;
            }
          }
        });
        
        return allLettersComplete;
      }
    });

    // textBlurAppear - text appears with animated blur effect
    this.registerEffect('textBlurAppear', {
      description: 'Text appears with smooth blur to clear transition',
      useRAF: true,
      initialState: (element) => {
        if (!element.dataset.originalContent) {
          element.dataset.originalContent = element.innerHTML;
        }
        
        const content = element.dataset.originalContent;
        const letters = this._parseContentIntoLetters(content);
        
        element.innerHTML = letters.map(letter => {
          if (letter.type === 'space') {
            return letter.content;
          } else {
            return `<span class="blur-appear-letter" style="display:inline-block; opacity:0; filter:blur(12px); transform:translateY(15px) scale(0.9);">${letter.content}</span>`;
          }
        }).join('');
      },
      animate: (element, { duration, delay }, progress) => {
        const words = element.querySelectorAll('.blur-appear-letter');
        const durationMs = this._convertTimeToMs(duration);
        const delayMs = this._convertTimeToMs(delay);
        const staggerMs = 80;
        
        const totalDuration = delayMs + durationMs + ((words.length - 1) * staggerMs);
        
        // Smooth ease-out cubic for natural motion
        const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
        
        let allWordsComplete = true;
        
        words.forEach((word, index) => {
          const wordDelay = delayMs + (index * staggerMs);
          const wordProgress = Math.max(0, Math.min(1, (progress * totalDuration - wordDelay) / durationMs));
          
          if (wordProgress < 1) {
            allWordsComplete = false;
          }
          
          if (wordProgress > 0) {
            const eased = easeOutCubic(wordProgress);
            
            // Animate blur from 12px to 0px
            const blurAmount = 12 * (1 - eased);
            
            // Animate scale from 0.9 to 1
            const scale = 0.9 + (eased * 0.1);
            
            // Animate translateY from 15px to 0px
            const translateY = 15 * (1 - eased);
            
            // Apply all transforms
            word.style.filter = `blur(${blurAmount}px)`;
            word.style.transform = `translateY(${translateY}px) scale(${scale})`;
            word.style.opacity = eased.toString();
          }
        });
        
        return allWordsComplete;
      }
    });
  }
  
  /**
   * Set initial state for an element based on its effect type
   * @param {HTMLElement} element - Element to prepare
   * @param {Object} config - Effect configuration
   * @private
   */
  _setInitialState(element, config) {
    if (!config || !config.type) return;
    
    const effect = this.effectRegistry[config.type];
    
    if (!effect || !effect.initialState) {
      this.logger.warn(`No initialState handler for effect: ${config.type}`);
      return;
    }
    
    try {
      effect.initialState(element);
      
      if (this.config.debug) {
        element.dataset.effectPrepared = 'true';
      }
    } catch (error) {
      this.logger.error(`Error setting initial state for effect "${config.type}":`, error);
    }
  }
  
  /**
   * Play a CSS transition-based animation
   * @param {HTMLElement} element - Element to animate
   * @param {Object} config - Animation configuration
   * @param {Function} onComplete - Callback when animation completes
   * @private
   */
  _playCSSTransition(element, config, onComplete) {
    const effect = this.effectRegistry[config.type];
    
    if (!effect || !effect.animate) {
      this.logger.error(`Cannot play effect: ${config.type} - missing animate function`);
      return;
    }
    
    // Set up transition end listener
    const onTransitionEnd = (e) => {
      // Only trigger for this element's transitions, not children
      if (e.target !== element) return;
      
      element.removeEventListener('transitionend', onTransitionEnd);
      
      // Remove from active animations
      if (this.animations.has(element)) {
        this.animations.delete(element);
      }
      
      // Dispatch complete event
      this._dispatchEvent(element, 'effectcomplete', {
        type: config.type,
        duration: config.duration,
        delay: config.delay
      });
      
      // Call complete callback
      if (onComplete) onComplete();
    };
    
    element.addEventListener('transitionend', onTransitionEnd);
    
    // Apply the animation
    effect.animate(element, {
      duration: config.duration,
      delay: config.delay,
      easing: config.easing,
      ...config.params
    });
    
    // Calculate total animation time to set a fallback timer
    // (in case transitionend doesn't fire)
    const totalTime = this._convertTimeToMs(config.duration) + this._convertTimeToMs(config.delay) + 50;
    
    setTimeout(() => {
      if (this.animations.has(element)) {
        element.removeEventListener('transitionend', onTransitionEnd);
        this.animations.delete(element);
        
        // Dispatch complete event
        this._dispatchEvent(element, 'effectcomplete', {
          type: config.type,
          duration: config.duration,
          delay: config.delay
        });
        
        // Call complete callback
        if (onComplete) onComplete();
      }
    }, totalTime);
  }
  
  /**
   * Start or continue the RAF animation loop
   * @private
   */
  _startRAFLoop() {
    // If loop is already running, just return
    if (this._rafId) return;
    
    const animate = (timestamp) => {
      // Calculate elapsed time since last frame
      const now = performance.now();
      const elapsedMs = this._lastFrameTime ? now - this._lastFrameTime : 0;
      this._lastFrameTime = now;
      
      // Track FPS in debug mode
      if (this.perfMonitor) {
        this.perfMonitor.recordFrame(elapsedMs);
      }
      
      // Process all active animations
      let hasActiveAnimations = false;
      
      this.animations.forEach((animation, element) => {
        if (!animation.active) return;
        
        // Skip if element is no longer in DOM
        if (!element.isConnected) {
          this.animations.delete(element);
          return;
        }
        
        hasActiveAnimations = true;
        
        // Calculate progress
        const elapsedTime = now - animation.startTime;
        const totalDuration = this._convertTimeToMs(animation.config.duration) + 
                            this._convertTimeToMs(animation.config.delay);
        
        const progress = Math.min(1, elapsedTime / totalDuration);
        
        // Get effect function
        const effect = this.effectRegistry[animation.config.type];
        
        if (effect && effect.animate) {
          try {
            // Process this frame
            const isComplete = effect.animate(element, animation.config, progress);
            
            // If animation is complete
            if (isComplete || progress >= 1) {
              animation.active = false;
              this.animations.delete(element);
              
              // Dispatch complete event
              this._dispatchEvent(element, 'effectcomplete', {
                type: animation.config.type,
                duration: animation.config.duration,
                delay: animation.config.delay
              });
              
              // Call complete callback
              if (animation.onComplete) {
                animation.onComplete();
              }
            }
          } catch (error) {
            this.logger.error(`Error in animation frame for effect "${animation.config.type}":`, error);
            animation.active = false;
            this.animations.delete(element);
          }
        }
      });
      
      // Continue loop if there are active animations
      if (hasActiveAnimations) {
        this._rafId = requestAnimationFrame(animate);
      } else {
        this._rafId = null;
        this._lastFrameTime = null;
        
        if (this.perfMonitor) {
          this.logger.debug(`Animation loop ended. Average FPS: ${this.perfMonitor.getAverageFPS().toFixed(1)}`);
          this.perfMonitor.reset();
        }
      }
    };
    
    // Start the loop
    this._rafId = requestAnimationFrame(animate);
  }
  
  /**
   * Create an observer for an element
   * @param {HTMLElement} element - Element to observe
   * @param {Object} config - Observation configuration
   * @private
   */
  _observeElement(element, config) {
    // Create observer if needed
    if (!this.observers.has(element)) {
      const observerOptions = {
        threshold: config.threshold || this.config.threshold,
        rootMargin: config.rootMargin || this.config.rootMargin
      };
      
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // Play the animation
            this.play(entry.target);
            
            // If configured to only animate once, disconnect observer
            if (config.once !== false && this.config.once !== false) {
              observer.disconnect();
              this.observers.delete(entry.target);
            }
          }
        });
      }, observerOptions);
      
      observer.observe(element);
      this.observers.set(element, observer);
    }
  }
  
  /**
   * Parse element configuration from data attributes
   * @param {HTMLElement} element - Element to parse
   * @returns {Object|null} - Parsed configuration or null
   * @private
   */
  _parseElementConfig(element) {
    try {
      if (!element || !element.dataset || !element.dataset.effect) {
        return null;
      }
      
      const effectString = element.dataset.effect;
      const parts = effectString.split(',').map(part => part.trim());
      
      let config = {
        // Default values from global config
        duration: this.config.defaultDuration,
        delay: this.config.defaultDelay,
        easing: this.config.defaultEasing,
        once: this.config.once,
        threshold: this.config.threshold,
        rootMargin: this.config.rootMargin,
        params: {}
      };
      
      // Parse each part of the data-effect string
      parts.forEach(part => {
        // Check for key=value format
        if (part.includes('=')) {
          const [key, value] = part.split('=').map(s => s.trim());
          
          // Handle special keys
          if (key === 'duration' || key === 'delay' || key === 'easing' || 
              key === 'once' || key === 'threshold' || key === 'rootMargin') {
            config[key] = value;
          } 
          // Handle nested params
          else if (key.includes('.')) {
            const [paramGroup, paramName] = key.split('.');
            if (!config.params[paramGroup]) config.params[paramGroup] = {};
            config.params[paramGroup][paramName] = value;
          } 
          // Handle direct params
          else {
            config.params[key] = value;
          }
        } 
        // If not key=value, treat as effect type
        else if (this.effectRegistry[part]) {
          config.type = part;
        }
      });
      
      // If no type was found, look for the first key that matches a registered effect
      if (!config.type) {
        for (const key in config.params) {
          if (this.effectRegistry[key]) {
            config.type = key;
            config.duration = config.params[key] || config.duration;
            delete config.params[key];
            break;
          }
        }
      }
      
      // If still no type, use fadeIn as default
      if (!config.type) {
        config.type = 'fadeIn';
      }
      
      // Parse boolean values
      if (typeof config.once === 'string') {
        config.once = config.once.toLowerCase() === 'true';
      }
      
      // Check if this effect uses RAF
      config.useRAF = this.effectRegistry[config.type]?.useRAF === true;
      
      return config;
    } catch (error) {
      this.logger.error('Error parsing effect configuration:', error, element);
      return null;
    }
  }
  
  /**
   * Dispatch a custom event on an element
   * @param {HTMLElement} element - Element to dispatch event on
   * @param {String} eventName - Name of the event
   * @param {Object} detail - Event details
   * @private
   */
  _dispatchEvent(element, eventName, detail) {
    if (!element || !eventName) return;
    
    const event = new CustomEvent(eventName, {
      bubbles: true,
      detail: detail || {}
    });
    
    element.dispatchEvent(event);
  }
  
  /**
   * Convert time string to milliseconds
   * @param {String} timeStr - Time string (e.g., "0.5s" or "500ms")
   * @returns {Number} Time in milliseconds
   * @private
   */
  _convertTimeToMs(timeStr) {
    if (!timeStr) return 0;
    
    if (typeof timeStr === 'number') return timeStr;
    
    if (timeStr.endsWith('ms')) {
      return parseFloat(timeStr);
    } else if (timeStr.endsWith('s')) {

      return parseFloat(timeStr) * 1000;
    }
    
    return parseFloat(timeStr) || 0;
  }
  
  /**
   * Check if reduced motion preferences should be applied
   * @private
   */
  _checkReducedMotion() {
    let shouldReduceMotion = false;
    
    // Check user preference in browser
    if (this.config.reducedMotion === 'auto' || this.config.reducedMotion === true) {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      shouldReduceMotion = query.matches;
    } 
    // Explicitly set to always reduce
    else if (this.config.reducedMotion === 'always') {
      shouldReduceMotion = true;
    }
    
    this._reducedMotion = shouldReduceMotion;
    
    if (shouldReduceMotion) {
      this.logger.info('Reduced motion is active - animations will be simplified');
    }
  }
  
  /**
   * Parse content into words
   * @param {String} content - HTML content
   * @returns {Array} Array of word objects
   * @private
   */
  _parseContentIntoWords(content) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${content}</div>`, 'text/html');
    const result = [];
    
    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        // Split text by spaces and process
        const parts = node.textContent.split(/(\s+)/);
        
        parts.forEach(part => {
          if (part.trim() === '') {
            // This is whitespace
            result.push({ type: 'space', content: part });
          } else {
            // This is a word
            result.push({ type: 'word', content: part });
          }
        });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // Process each child of the element
        Array.from(node.childNodes).forEach(child => {
          processNode(child);
        });
      }
    };
    
    Array.from(doc.querySelector('div').childNodes).forEach(node => {
      processNode(node);
    });
    
    return result;
  }
  
  /**
   * Parse content into letters
   * @param {String} content - HTML content
   * @returns {Array} Array of letter objects
   * @private
   */
  _parseContentIntoLetters(content) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${content}</div>`, 'text/html');
    const result = [];
    
    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        // Process each character
        Array.from(node.textContent).forEach(char => {
          if (char === ' ' || char === '\n' || char === '\t') {
            // This is whitespace
            result.push({ type: 'space', content: char });
          } else {
            // This is a letter
            result.push({ type: 'letter', content: char });
          }
        });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // Process each child of the element
        Array.from(node.childNodes).forEach(child => {
          processNode(child);
        });
      }
    };
    
    Array.from(doc.querySelector('div').childNodes).forEach(node => {
      processNode(node);
    });
    
    return result;
  }
  
  /**
   * Serialize DOM nodes for text typing effect
   * @param {NodeList} nodes - Nodes to serialize
   * @returns {Array} Serialized node objects
   * @private
   */
  _serializeNodes(nodes) {
    const result = [];
    
    Array.from(nodes).forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        result.push({
          type: 'text',
          content: node.textContent
        });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const attributes = {};
        
        // Copy attributes
        Array.from(node.attributes).forEach(attr => {
          attributes[attr.name] = attr.value;
        });
        
        result.push({
          type: 'element',
          tag: node.tagName.toLowerCase(),
          attributes: attributes,
          children: this._serializeNodes(node.childNodes)
        });
      }
    });
    
    return result;
  }
  
  /**
   * Check if a tag is self-closing
   * @param {String} tag - HTML tag name
   * @returns {Boolean} Whether tag is self-closing
   * @private
   */
  _isSelfClosingTag(tag) {
    const selfClosingTags = [
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 
      'link', 'meta', 'param', 'source', 'track', 'wbr'
    ];
    return selfClosingTags.includes(tag.toLowerCase());
  }

  /**
   * Adjust color brightness
   * @param {String} color - Hex color (e.g., "#ff0000")
   * @param {Number} factor - Brightness factor (0-1)
   * @returns {String} Adjusted hex color
   * @private
   */
  _adjustColorBrightness(color, factor) {
    // Remove # if present
    const hex = color.replace('#', '');
    
    // Parse RGB components
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Adjust brightness
    const newR = Math.round(r * factor);
    const newG = Math.round(g * factor);
    const newB = Math.round(b * factor);
    
    // Convert back to hex
    const toHex = (n) => {
      const hex = n.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  }
}

/**
 * Logger class for handling different logging levels
 */
class Logger {
  constructor(level = 'error') {
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
      none: 4
    };
    this.level = this.levels[level] || this.levels.error;
    
    // Add timestamps to logs
    this.timestamp = true;
  }
  
  /**
   * Set logging level
   * @param {String} level - Logging level
   */
  setLevel(level) {
    this.level = this.levels[level] || this.level;
  }
  
  /**
   * Get prefix for log messages
   * @returns {String} Log prefix
   * @private
   */
  _getPrefix() {
    if (!this.timestamp) return '[Effects] ';
    
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
    
    return `[Effects ${time}] `;
  }
  
  /**
   * Log debug message
   * @param {String} message - Message to log
   * @param {...any} args - Additional arguments
   */
  debug(message, ...args) {
    if (this.level <= this.levels.debug) {
      console.debug(this._getPrefix() + message, ...args);
    }
  }
  
  /**
   * Log info message
   * @param {String} message - Message to log
   * @param {...any} args - Additional arguments
   */
  info(message, ...args) {
    if (this.level <= this.levels.info) {
      console.info(this._getPrefix() + message, ...args);
    }
  }
  
  /**
   * Log warning message
   * @param {String} message - Message to log
   * @param {...any} args - Additional arguments
   */
  warn(message, ...args) {
    if (this.level <= this.levels.warn) {
      console.warn(this._getPrefix() + message, ...args);
    }
  }
  
  /**
   * Log error message
   * @param {String} message - Message to log
   * @param {...any} args - Additional arguments
   */
  error(message, ...args) {
    if (this.level <= this.levels.error) {
      console.error(this._getPrefix() + message, ...args);
    }
  }
}

/**
 * Performance monitoring utility
 */
class PerformanceMonitor {
  constructor() {
    this.timings = new Map();
    this.frames = [];
    this.maxFrames = 100; // Number of frames to keep for FPS calculation
  }
  
  /**
   * Start timing an operation
   * @param {String} id - Operation identifier
   */
  start(id) {
    if (!id) return;
    this.timings.set(id, performance.now());
  }
  
  /**
   * End timing an operation
   * @param {String} id - Operation identifier
   * @returns {Number} Elapsed time in milliseconds
   */
  end(id) {
    if (!id || !this.timings.has(id)) return 0;
    
    const startTime = this.timings.get(id);
    const endTime = performance.now();
    const elapsed = endTime - startTime;
    
    this.timings.set(id + '_result', elapsed);
    return elapsed;
  }
  
  /**
   * Get the time for an operation
   * @param {String} id - Operation identifier
   * @returns {Number} Elapsed time in milliseconds
   */
  getTime(id) {
    return this.timings.get(id + '_result') || 0;
  }
  
  /**
   * Record a frame duration for FPS calculation
   * @param {Number} frameDuration - Frame duration in milliseconds
   */
  recordFrame(frameDuration) {
    this.frames.push(frameDuration);
    
    // Keep only the last N frames
    if (this.frames.length > this.maxFrames) {
      this.frames.shift();
    }
  }
  
  /**
   * Get the average FPS from recorded frames
   * @returns {Number} Average FPS
   */
  getAverageFPS() {
    if (this.frames.length === 0) return 0;
    
    const avgFrameTime = this.frames.reduce((sum, time) => sum + time, 0) / this.frames.length;
    return avgFrameTime > 0 ? 1000 / avgFrameTime : 0;
  }
  
  /**
   * Reset all timings and frames
   */
  reset() {
    this.timings.clear();
    this.frames = [];
  }
}

/**
 * Throttle function to limit execution frequency
 * @param {Function} func - Function to throttle
 * @param {Number} limit - Minimum time between executions in ms
 * @returns {Function} Throttled function
 */
function throttle(func, limit) {
  let inThrottle;
  let lastResult;
  
  return function(...args) {
    if (!inThrottle) {
      inThrottle = true;
      lastResult = func.apply(this, args);
      
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
    
    return lastResult;
  };
}

// Create and export singleton instance
const Effects = new EffectsSystem();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Detect if the device is primarily touch-based
  const isTouchDevice = () => {
    return ('ontouchstart' in window) || 
           (navigator.maxTouchPoints > 0) || 
           (navigator.msMaxTouchPoints > 0);
  };
  
  // Initialize with default options
  Effects.init();
});


// Export for use in other files
window.Effects = Effects;
