<script setup>
import {
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldRoot,
} from 'reka-ui'

const props = defineProps({
  modelValue: { type: Number, required: true },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 5000 },
  step: { type: Number, default: 25 },
})

const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <NumberFieldRoot
    class="flex items-center gap-1"
    :step="step"
    :model-value="modelValue"
    :min="min"
    :max="max"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <NumberFieldDecrement class="text-light px-1">-</NumberFieldDecrement>
    <NumberFieldInput
      class="text-lighter border-grey bg-dark w-12 rounded border px-1 py-0.5 text-right text-xs"
      :step="step"
    />
    <NumberFieldIncrement class="text-light px-1">+</NumberFieldIncrement>
  </NumberFieldRoot>
</template>

<style scoped>
@reference "../assets/tailwind.css";
</style>
