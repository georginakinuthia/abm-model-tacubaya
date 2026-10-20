<script setup>
import {
  ArrowReset20Regular,
  ChevronCircleDown20Regular,
  Home20Regular,
  WeatherCloudy20Regular,
  WeatherSunny20Regular,
} from '@vicons/fluent'
import { storeToRefs } from 'pinia'
import {
  AccordionContent,
  AccordionHeader,
  AccordionItem,
  AccordionRoot,
  AccordionTrigger,
  SliderRange,
  SliderRoot,
  SliderThumb,
  SliderTrack,
  SwitchRoot,
  SwitchThumb,
} from 'reka-ui'
import { computed, ref } from 'vue'
import { inject } from 'vue'

import { useBehaviorStore } from '../stores/behavior'
import { useSandboxStore } from '../stores/sandbox'
import { SANDBOX_TERRAINS } from '../stores/sandboxTerrains'
import TimerWidget from './TimerWidget.vue'

const appMode = inject('appMode')
const behaviorStore = useBehaviorStore()
const sandboxStore = useSandboxStore()

const accordionValue = ref(null)

const {
  isSunny,
  behaviorDiversity,
  personalSpace,
  speedBase,
  debugOrcaEnabled,
  debugDensityEnabled,
  debugMomentumEnabled,
  debugDensityBeta,
  debugMomentumBase,
  debugFollowingStrength,
} = storeToRefs(behaviorStore)

// Slider array adapters (reka-ui sliders use array format)
const behaviorDiversityValue = computed({
  get: () => [behaviorDiversity.value],
  set: (val) => { behaviorDiversity.value = val[0] },
})
const personalSpaceValue = computed({
  get: () => [personalSpace.value],
  set: (val) => { personalSpace.value = val[0] },
})
const speedBaseValue = computed({
  get: () => [speedBase.value],
  set: (val) => { speedBase.value = val[0] },
})
const spawnRateValue = computed({
  get: () => [sandboxStore.spawnRateMultiplier],
  set: (val) => { sandboxStore.spawnRateMultiplier = val[0] },
})

// Debug slider adapters
const densityBetaValue = computed({
  get: () => [Math.abs(debugDensityBeta.value)],
  set: (val) => { debugDensityBeta.value = -val[0] },
})
const momentumBaseValue = computed({
  get: () => [debugMomentumBase.value],
  set: (val) => { debugMomentumBase.value = val[0] },
})
const followingStrengthValue = computed({
  get: () => [debugFollowingStrength.value],
  set: (val) => { debugFollowingStrength.value = val[0] },
})
const emit = defineEmits(['switch-terrain'])
</script>

<template>
  <div
    id="sandbox-controls"
    class="flex h-full w-full flex-col items-stretch gap-1.5 overflow-x-hidden overflow-y-auto"
  >
    <TimerWidget :store="sandboxStore" />

    <!-- Terrain & Spawn Rate (always visible) -->
    <div class="bg-dark text-lighter w-full rounded-lg p-3">
      <div class="accordion-child">
        <div class="accordion-child-pairing">
          <div class="accordion-child-left accordion-heading">Terrain</div>
        </div>
      </div>
      <div class="flex w-full flex-col gap-1">
        <button
          v-for="terrain in SANDBOX_TERRAINS"
          :key="terrain.id"
          class="cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors"
          :class="sandboxStore.currentTerrainId === terrain.id
            ? 'bg-darker text-lighter'
            : 'text-lighter hover:bg-dark'"
          @click="emit('switch-terrain', terrain.id)"
        >
          <div class="font-medium">{{ terrain.label }}</div>
          <div class="mt-0.5 text-xs opacity-70">{{ terrain.description }}</div>
        </button>
      </div>

      <div class="accordion-child mt-2">
        <div class="accordion-child-pairing">
          <label class="accordion-child-left">Spawn Rate</label>
          <div class="accordion-child-right">{{ sandboxStore.spawnRateMultiplier.toFixed(1) }}×</div>
        </div>
        <SliderRoot v-model="spawnRateValue" :min="0" :max="2" :step="0.1" class="slider-root">
          <SliderTrack class="slider-track">
            <SliderRange class="slider-range" />
          </SliderTrack>
          <SliderThumb class="slider-thumb" aria-label="Spawn Rate" />
        </SliderRoot>
      </div>
    </div>

    <AccordionRoot
      v-model="accordionValue"
      class="accordion-root"
      type="single"
      :collapsible="true"
    >
      <!-- Movement -->
      <AccordionItem value="movement" class="accordion-item">
        <AccordionHeader class="border-grey/20 border-b">
          <AccordionTrigger class="accordion-trigger group">
            <span class="accordion-trigger-text">Movement</span>
            <ChevronCircleDown20Regular class="accordion-trigger-icon" />
          </AccordionTrigger>
        </AccordionHeader>
        <AccordionContent class="accordion-content">
          <!-- Weather Switch -->
          <div class="accordion-child">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">Weather</label>
              <div class="accordion-child-right">
                <WeatherCloudy20Regular
                  class="h-4 w-4 transition-colors"
                  :class="isSunny ? 'text-light' : 'text-lighter'"
                />
                <SwitchRoot v-model="isSunny" class="switch-root">
                  <SwitchThumb class="switch-thumb" />
                </SwitchRoot>
                <WeatherSunny20Regular
                  class="h-4 w-4 transition-colors"
                  :class="isSunny ? 'text-accent' : 'text-light'"
                />
              </div>
            </div>
          </div>

          <div class="accordion-child">
            <div class="accordion-child-pairing">
              <div class="accordion-child-left accordion-heading">Parameters</div>
              <button
                class="accordion-child-right btn"
                title="Reset to defaults"
                @click="behaviorStore.resetParams()"
              >
                <ArrowReset20Regular class="h-4 w-4" />
              </button>
            </div>
          </div>

          <div class="accordion-child">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">Path Randomness</label>
              <div class="accordion-child-right">{{ (behaviorDiversity * 100).toFixed(0) }}%</div>
            </div>
            <SliderRoot v-model="behaviorDiversityValue" :min="0" :max="1" :step="0.05" class="slider-root">
              <SliderTrack class="slider-track">
                <SliderRange class="slider-range" />
              </SliderTrack>
              <SliderThumb class="slider-thumb" aria-label="Path Randomness" />
            </SliderRoot>
          </div>

          <div class="accordion-child">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">Personal Space</label>
              <div class="accordion-child-right">{{ personalSpace.toFixed(2) }}m</div>
            </div>
            <SliderRoot v-model="personalSpaceValue" :min="0.3" :max="1.5" :step="0.05" class="slider-root">
              <SliderTrack class="slider-track">
                <SliderRange class="slider-range" />
              </SliderTrack>
              <SliderThumb class="slider-thumb" aria-label="Personal Space" />
            </SliderRoot>
          </div>

          <div class="accordion-child">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">Walking Speed</label>
              <div class="accordion-child-right">{{ speedBase.toFixed(2) }}m/s</div>
            </div>
            <SliderRoot v-model="speedBaseValue" :min="0.6" :max="1.8" :step="0.05" class="slider-root">
              <SliderTrack class="slider-track">
                <SliderRange class="slider-range" />
              </SliderTrack>
              <SliderThumb class="slider-thumb" aria-label="Walking Speed" />
            </SliderRoot>
          </div>
        </AccordionContent>
      </AccordionItem>

      <!-- Advanced -->
      <AccordionItem value="experimental" class="accordion-item">
        <AccordionHeader class="border-grey/20 border-b">
          <AccordionTrigger class="accordion-trigger group">
            <span class="accordion-trigger-text">Advanced</span>
            <ChevronCircleDown20Regular class="accordion-trigger-icon" />
          </AccordionTrigger>
        </AccordionHeader>
        <AccordionContent class="accordion-content">
          <div class="accordion-child">
            <div class="accordion-child-pairing">
              <div class="accordion-child-left"></div>
              <button
                class="accordion-child-right btn"
                title="Reset to defaults"
                @click="behaviorStore.resetAdvancedParams()"
              >
                <ArrowReset20Regular class="h-4 w-4" />
              </button>
            </div>
          </div>

          <!-- On/Off toggles -->
          <div class="accordion-child">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">ORCA</label>
              <SwitchRoot v-model="debugOrcaEnabled" class="switch-root">
                <SwitchThumb class="switch-thumb" />
              </SwitchRoot>
            </div>
          </div>
          <div class="accordion-child">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">Density Avoidance</label>
              <SwitchRoot v-model="debugDensityEnabled" class="switch-root">
                <SwitchThumb class="switch-thumb" />
              </SwitchRoot>
            </div>
          </div>
          <div class="accordion-child">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">Momentum</label>
              <SwitchRoot v-model="debugMomentumEnabled" class="switch-root">
                <SwitchThumb class="switch-thumb" />
              </SwitchRoot>
            </div>
          </div>

          <!-- Sliders -->
          <div class="accordion-child" :class="{ 'opacity-30 pointer-events-none': !debugDensityEnabled }">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">Density Beta</label>
              <div class="accordion-child-right">{{ debugDensityBeta.toFixed(1) }}</div>
            </div>
            <SliderRoot v-model="densityBetaValue" :min="0" :max="5.0" :step="0.25" :disabled="!debugDensityEnabled" class="slider-root">
              <SliderTrack class="slider-track">
                <SliderRange class="slider-range" />
              </SliderTrack>
              <SliderThumb class="slider-thumb" aria-label="Density Beta" />
            </SliderRoot>
          </div>

          <div class="accordion-child" :class="{ 'opacity-30 pointer-events-none': !debugMomentumEnabled }">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">Momentum</label>
              <div class="accordion-child-right">{{ debugMomentumBase.toFixed(2) }}</div>
            </div>
            <SliderRoot v-model="momentumBaseValue" :min="0" :max="0.8" :step="0.05" :disabled="!debugMomentumEnabled" class="slider-root">
              <SliderTrack class="slider-track">
                <SliderRange class="slider-range" />
              </SliderTrack>
              <SliderThumb class="slider-thumb" aria-label="Momentum" />
            </SliderRoot>
          </div>

          <div class="accordion-child" :class="{ 'opacity-30 pointer-events-none': !debugMomentumEnabled }">
            <div class="accordion-child-pairing">
              <label class="accordion-child-left">Following</label>
              <div class="accordion-child-right">{{ debugFollowingStrength.toFixed(2) }}</div>
            </div>
            <SliderRoot v-model="followingStrengthValue" :min="0" :max="1.0" :step="0.05" :disabled="!debugMomentumEnabled" class="slider-root">
              <SliderTrack class="slider-track">
                <SliderRange class="slider-range" />
              </SliderTrack>
              <SliderThumb class="slider-thumb" aria-label="Following" />
            </SliderRoot>
          </div>
        </AccordionContent>
      </AccordionItem>
    </AccordionRoot>

    <div
      class="bg-dark mt-auto flex w-full cursor-pointer items-center justify-center rounded-lg py-3"
      title="Back to Freetown"
      @click="appMode = 'freetown'"
    >
      <Home20Regular class="btn h-6 w-6" />
    </div>
  </div>
</template>
