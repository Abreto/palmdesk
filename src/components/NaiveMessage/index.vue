<template>
  <div></div>
</template>

<script lang="ts">
export default {
  name: 'NaiveMessage',
};
</script>

<script lang="ts" setup>
import { useMessage } from 'naive-ui';

window.$message = useMessage();
</script>

<style lang="scss" scoped></style>
