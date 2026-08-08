<script setup>
import { onMounted, ref } from 'vue';

const stars = ref([
  { top: '12%', left: '8%', delay: '0.2s', size: '5px', color: '#38bdf8' },
  { top: '22%', left: '88%', delay: '0.9s', size: '4px', color: '#818cf8' },
  { top: '38%', left: '16%', delay: '1.6s', size: '6px', color: '#38bdf8' },
  { top: '48%', left: '92%', delay: '2.3s', size: '4px', color: '#c084fc' },
  { top: '65%', left: '12%', delay: '3.0s', size: '5px', color: '#60a5fa' },
  { top: '78%', left: '82%', delay: '0.6s', size: '6px', color: '#38bdf8' },
  { top: '18%', left: '46%', delay: '1.3s', size: '4px', color: '#ec4899' },
  { top: '85%', left: '38%', delay: '2.0s', size: '5px', color: '#818cf8' },
  { top: '30%', left: '76%', delay: '2.7s', size: '4px', color: '#38bdf8' },
  { top: '55%', left: '28%', delay: '3.4s', size: '5px', color: '#a855f7' },
  { top: '8%', left: '68%', delay: '1.8s', size: '4px', color: '#38bdf8' },
  { top: '72%', left: '62%', delay: '2.5s', size: '5px', color: '#60a5fa' },
]);
</script>

<template>
  <div class="hero-star-field" aria-hidden="true">
    <div
      v-for="(star, i) in stars"
      :key="i"
      class="star-dot"
      :style="{
        top: star.top,
        left: star.left,
        width: star.size,
        height: star.size,
        backgroundColor: star.color,
        boxShadow: `0 0 12px ${star.color}, 0 0 24px ${star.color}`,
        animationDelay: star.delay
      }"
    ></div>
  </div>
</template>

<style scoped>
.hero-star-field {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}

.star-dot {
  position: absolute;
  border-radius: 50%;
  opacity: 0.15;
  animation: starTwinklePulse 4.2s infinite ease-in-out;
}

@keyframes starTwinklePulse {
  0%, 100% {
    opacity: 0.1;
    transform: scale(0.7);
  }
  50% {
    opacity: 1;
    transform: scale(1.65);
    filter: brightness(1.6);
  }
}
</style>
